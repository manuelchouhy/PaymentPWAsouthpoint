import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pendingToPayByContractor, invoicelessPaidRows, summarizeEntries } from './paymentsGrouping.js'

// Helper: una hora aprobada de un allocation dado — se sobreescribe lo que haga falta.
const e = (o) => ({ status: 'Approved', allocation: 'sp_internal', hours: 1, user: 'Ana', ...o })

test('pendingToPayByContractor agrupa por contractor, suma horas y arma el desglose', () => {
  const entries = [
    e({ id: 1, user: 'Ana', hours: 4, project: 'P1', task: 'T1', date: '2026-08-14' }),
    e({ id: 2, user: 'Ana', hours: 2, project: 'P1', task: 'T1', date: '2026-08-13' }),
    e({ id: 3, user: 'Bob', hours: 3, project: 'P2', task: 'T2', date: '2026-08-07' }),
  ]
  const groups = pendingToPayByContractor(entries, [], [], 'sp_internal')
  // Orden por horas desc: Ana (6h) antes que Bob (3h).
  assert.equal(groups.length, 2)
  assert.equal(groups[0].user, 'Ana')
  assert.equal(groups[0].hours, 6)
  assert.deepEqual(groups[0].entryIds, [1, 2])
  assert.equal(groups[0].entries.length, 2)
  // El desglose lleva client/projectNumber (null si la entry no viene enriquecida
  // con deriveEntriesClient), además de project/task/date/hours.
  assert.deepEqual(groups[0].entries[0], {
    id: 1, hours: 4, project: 'P1', projectNumber: null, client: null, task: 'T1', date: '2026-08-14',
  })
  assert.equal(groups[1].user, 'Bob')
  assert.equal(groups[1].hours, 3)
})

test('pendingToPayByContractor filtra por allocation y sólo horas Approved', () => {
  const entries = [
    e({ id: 1, allocation: 'sp_internal', status: 'Approved', hours: 5 }),
    e({ id: 2, allocation: 'sp_internal', status: 'Pending', hours: 5 }), // no aprobada
    e({ id: 3, allocation: 'overage', status: 'Approved', hours: 5 }), // otro allocation
    e({ id: 4, allocation: 'bill_to_client', status: 'Approved', hours: 5 }),
  ]
  const groups = pendingToPayByContractor(entries, [], [], 'sp_internal')
  assert.equal(groups.length, 1)
  assert.equal(groups[0].hours, 5)
  assert.deepEqual(groups[0].entryIds, [1])
})

test('pendingToPayByContractor excluye horas ya pagadas o ya facturadas', () => {
  const entries = [
    e({ id: 1, user: 'Ana', hours: 3 }),
    e({ id: 2, user: 'Ana', hours: 3 }), // ya pagada
    e({ id: 3, user: 'Ana', hours: 3 }), // ya en una factura
  ]
  const payments = [{ invoiceId: null, entryIds: ['2'] }]
  const invoices = [{ entryIds: [3] }]
  const groups = pendingToPayByContractor(entries, payments, invoices, 'sp_internal')
  assert.equal(groups.length, 1)
  assert.equal(groups[0].hours, 3)
  assert.deepEqual(groups[0].entryIds, [1])
})

test('pendingToPayByContractor sirve igual para overage', () => {
  const entries = [
    e({ id: 1, allocation: 'overage', hours: 2 }),
    e({ id: 2, allocation: 'sp_internal', hours: 9 }),
  ]
  const groups = pendingToPayByContractor(entries, [], [], 'overage')
  assert.equal(groups.length, 1)
  assert.equal(groups[0].hours, 2)
})

test('pendingToPayByContractor exige un allocation invoice-less válido', () => {
  // Sin allocation (o uno inválido) NO debe devolver [] en silencio: eso
  // escondería el bug detrás de un "nada pendiente" en la UI.
  assert.throws(() => pendingToPayByContractor([], [], []), /allocation must be one of/)
  assert.throws(() => pendingToPayByContractor([], [], [], 'bill_to_client'), /allocation must be one of/)
})

test('invoicelessPaidRows separa pagos de overage y de sp_internal', () => {
  const entries = [
    { id: 1, allocation: 'sp_internal', hours: 4 },
    { id: 2, allocation: 'overage', hours: 3 },
  ]
  const payments = [
    { id: 'p1', invoiceId: null, entryIds: [1], userName: 'Ana', paymentDate: '2026-08-20' },
    { id: 'p2', invoiceId: null, entryIds: [2], userName: 'Bob', paymentDate: '2026-08-21' },
    { id: 'p3', invoiceId: 99, entryIds: [], userName: null, paymentDate: '2026-08-22' }, // pago por factura: no cuenta
  ]
  const { overage, spInternal } = invoicelessPaidRows(payments, entries)
  assert.equal(spInternal.length, 1)
  assert.equal(spInternal[0].id, 'p1')
  assert.equal(spInternal[0].user, 'Ana')
  assert.equal(spInternal[0].hours, 4)
  // Modelo en horas (slice 05): no hay amountPaid/currency.
  assert.equal(spInternal[0].amountPaid, undefined)
  assert.equal(spInternal[0].currency, undefined)
  assert.equal(overage.length, 1)
  assert.equal(overage[0].id, 'p2')
  assert.equal(overage[0].hours, 3)
})

test('invoicelessPaidRows ordena cada bucket por fecha desc (en horas, sin plata)', () => {
  const entries = [
    { id: 1, allocation: 'sp_internal', hours: 1 },
    { id: 2, allocation: 'sp_internal', hours: 1 },
  ]
  const payments = [
    { id: 'a', invoiceId: null, entryIds: [1], userName: 'Ana', paymentDate: '2026-08-10' },
    { id: 'b', invoiceId: null, entryIds: [2], userName: 'Ana', paymentDate: '2026-08-25' },
  ]
  const { spInternal } = invoicelessPaidRows(payments, entries)
  assert.deepEqual(spInternal.map((r) => r.id), ['b', 'a']) // más reciente arriba
  assert.equal(spInternal[0].hours, 1)
})

test('pendingToPayByContractor propaga client y projectNumber al desglose (entries enriquecidas)', () => {
  const entries = [
    e({ id: 1, user: 'Ana', hours: 4, project: 'P1', projectNumber: 'PRJ-1', client: 'HSS', task: 'T1', date: '2026-08-14' }),
  ]
  const groups = pendingToPayByContractor(entries, [], [], 'sp_internal')
  assert.deepEqual(groups[0].entries[0], {
    id: 1, hours: 4, project: 'P1', projectNumber: 'PRJ-1', client: 'HSS', task: 'T1', date: '2026-08-14',
  })
})

test('invoicelessPaidRows expone entryIds para poder expandir el detalle', () => {
  const entries = [
    { id: 1, allocation: 'sp_internal', hours: 4 },
    { id: 2, allocation: 'sp_internal', hours: 2 },
  ]
  const payments = [
    { id: 'p1', invoiceId: null, entryIds: [1, 2], userName: 'Ana', paymentDate: '2026-08-20' },
  ]
  const { spInternal } = invoicelessPaidRows(payments, entries)
  assert.deepEqual(spInternal[0].entryIds, [1, 2])
  assert.equal(spInternal[0].entryCount, 2)
})

test('summarizeEntries agrega proyectos/clientes distintos y el rango de fechas', () => {
  const summary = summarizeEntries([
    { project: 'P1', client: 'HSS', date: '2026-08-10' },
    { project: 'P1', client: 'HSS', date: '2026-08-14' },
    { project: 'P2', client: 'Acme', date: '2026-08-20' },
  ])
  assert.deepEqual(summary.projects, ['P1', 'P2'])
  assert.deepEqual(summary.clients, ['HSS', 'Acme'])
  assert.equal(summary.dateStart, '2026-08-10')
  assert.equal(summary.dateEnd, '2026-08-20')
})

test('summarizeEntries tolera lista vacía / campos faltantes sin romper', () => {
  const summary = summarizeEntries([{ hours: 1 }, null, { project: 'P1' }])
  assert.deepEqual(summary.projects, ['P1'])
  assert.deepEqual(summary.clients, [])
  assert.equal(summary.dateStart, null)
  assert.equal(summary.dateEnd, null)
})
