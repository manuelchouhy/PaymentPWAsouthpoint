import { test } from 'node:test'
import assert from 'node:assert/strict'
import { invoiceCompletion, payableInvoicesByContractor } from './invoiceCompletion.js'

// invoice_contractors de una factura, tal como los ve el front (camelCase, igual
// que Payment.entryIds / Invoice.entryIds). Helper con overrides.
const contractor = (name, entryIds, hours) => ({ contractor: name, entryIds, hours })
// Un pago cubre entryIds (paidEntryIdsFrom mira p.entryIds).
const payment = (entryIds) => ({ entryIds })

test('invoiceCompletion: sin pagos → Invoiced, nada pagado', () => {
  const contractors = [contractor('Ana', [1, 2], 8), contractor('Bob', [3], 5)]
  const out = invoiceCompletion(contractors, [])
  assert.equal(out.status, 'Invoiced')
  assert.equal(out.paidCount, 0)
  assert.equal(out.totalCount, 2)
  assert.equal(out.totalHours, 13)
  assert.equal(out.paidHours, 0)
  assert.deepEqual(
    out.contractors.map((c) => ({ contractor: c.contractor, paid: c.paid })),
    [{ contractor: 'Ana', paid: false }, { contractor: 'Bob', paid: false }],
  )
})

test('invoiceCompletion: algunos contractors pagados → partial', () => {
  const contractors = [contractor('Ana', [1, 2], 8), contractor('Bob', [3], 5)]
  const payments = [payment([1, 2])] // sólo Ana
  const out = invoiceCompletion(contractors, payments)
  assert.equal(out.status, 'partial')
  assert.equal(out.paidCount, 1)
  assert.equal(out.totalCount, 2)
  assert.equal(out.paidHours, 8)
  assert.equal(out.contractors.find((c) => c.contractor === 'Ana').paid, true)
  assert.equal(out.contractors.find((c) => c.contractor === 'Bob').paid, false)
})

test('invoiceCompletion: todos pagados → Paid', () => {
  const contractors = [contractor('Ana', [1, 2], 8), contractor('Bob', [3], 5)]
  const payments = [payment([1, 2]), payment([3])]
  const out = invoiceCompletion(contractors, payments)
  assert.equal(out.status, 'Paid')
  assert.equal(out.paidCount, 2)
  assert.equal(out.totalCount, 2)
  assert.equal(out.paidHours, 13)
})

test('invoiceCompletion: un contractor pago PARCIAL de sus horas NO cuenta como pagado', () => {
  // Ana tiene [1,2]; un pago cubre sólo 1. La LÍNEA no está paga hasta cubrir TODAS, pero la
  // factura sí refleja cobertura PARCIAL (pago parcial por período, ADR 0005): status 'partial'.
  const contractors = [contractor('Ana', [1, 2], 8)]
  const out = invoiceCompletion(contractors, [payment([1])])
  assert.equal(out.status, 'partial') // antes 'Invoiced'; ahora la cobertura parcial cuenta
  assert.equal(out.paidCount, 0) // ninguna línea 100% paga
  assert.equal(out.contractors[0].paid, false)
  assert.deepEqual(out.contractors[0].unpaidEntryIds, ['2']) // la 1 quedó cubierta
})

test('invoiceCompletion: 1 solo contractor se comporta como el flujo viejo (Invoiced↔Paid)', () => {
  const one = [contractor('Ana', [1, 2], 8)]
  assert.equal(invoiceCompletion(one, []).status, 'Invoiced')
  assert.equal(invoiceCompletion(one, [payment([1, 2])]).status, 'Paid')
})

test('invoiceCompletion: entryIds coercionan a String (numérico vs string mezclados)', () => {
  // El pago puede traer ids como string y el contractor como number (o viceversa).
  const contractors = [contractor('Ana', [1, 2], 8)]
  const out = invoiceCompletion(contractors, [payment(['1', '2'])])
  assert.equal(out.contractors[0].paid, true)
  assert.equal(out.status, 'Paid')
})

test('invoiceCompletion: paymentId marca al contractor pagado aunque el pago no traiga entry_ids', () => {
  // El pago POR FACTURA lleva entry_ids NULL/[], así que la cobertura por horas NO lo
  // detecta; el link payment_id de la fila invoice_contractors sí. Se preserva en la salida.
  const contractors = [
    { contractor: 'Ana', entryIds: [1, 2], hours: 8, paymentId: 'pay-9', supplierInvoiceNumber: 'SUP-1' },
    { contractor: 'Bob', entryIds: [3], hours: 5 },
  ]
  const out = invoiceCompletion(contractors, []) // sin pagos con entry_ids
  const ana = out.contractors.find((c) => c.contractor === 'Ana')
  assert.equal(ana.paid, true)
  assert.equal(ana.supplierInvoiceNumber, 'SUP-1') // campos originales preservados
  assert.equal(out.contractors.find((c) => c.contractor === 'Bob').paid, false)
  assert.equal(out.status, 'partial')
  assert.equal(out.paidCount, 1)
})

test('invoiceCompletion: contractor sin entryIds se EXCLUYE (no cuenta ni bloquea Paid)', () => {
  // Una fila anómala sin entry_ids no debe impedir que la factura llegue a Paid cuando
  // todo el trabajo real está pago. Se descarta de la lista y de los conteos.
  const contractors = [contractor('Ana', [], 0), contractor('Bob', [3], 5)]
  const out = invoiceCompletion(contractors, [payment([3])])
  assert.deepEqual(out.contractors.map((c) => c.contractor), ['Bob'])
  assert.equal(out.totalCount, 1)
  assert.equal(out.paidCount, 1)
  assert.equal(out.status, 'Paid')
})

test('invoiceCompletion: sin contractors → Invoiced, totales en cero (degenerado)', () => {
  const out = invoiceCompletion([], [])
  assert.equal(out.status, 'Invoiced')
  assert.equal(out.totalCount, 0)
  assert.equal(out.paidCount, 0)
  assert.equal(out.totalHours, 0)
})

test('invoiceCompletion: entradas nulas no rompen', () => {
  const out = invoiceCompletion(undefined, undefined)
  assert.equal(out.status, 'Invoiced')
  assert.equal(out.totalCount, 0)
})

test('invoiceCompletion: un elemento null dentro de payments no rompe', () => {
  const contractors = [contractor('Ana', [1, 2], 8)]
  const out = invoiceCompletion(contractors, [null, payment([1, 2])])
  assert.equal(out.status, 'Paid')
  assert.equal(out.contractors[0].paid, true)
})

// --- payableInvoicesByContractor (04b) ---

const invoice = (id, status, date) => ({ id, status, invoiceDate: date })

test('payableInvoicesByContractor: sólo facturas Invoiced son pagables; Paid se excluye', () => {
  const invoices = [invoice('i1', 'Invoiced', '2026-08-10'), invoice('i2', 'Paid', '2026-08-11')]
  const byInv = new Map([
    ['i1', [contractor('Ana', [1], 4)]],
    ['i2', [contractor('Bob', [2], 3)]],
  ])
  const out = payableInvoicesByContractor(invoices, byInv, [])
  assert.deepEqual(out.map((r) => r.invoice.id), ['i1'])
})

test('payableInvoicesByContractor: expande contractors pendientes y muestra progreso', () => {
  const invoices = [invoice('i1', 'Invoiced', '2026-08-10')]
  const byInv = new Map([['i1', [contractor('Ana', [1], 4), contractor('Bob', [2], 3)]]])
  const payments = [payment([1])] // Ana pagada, Bob pendiente
  const [row] = payableInvoicesByContractor(invoices, byInv, payments)
  assert.equal(row.status, 'partial')
  assert.equal(row.paidCount, 1)
  assert.equal(row.totalCount, 2)
  assert.deepEqual(row.pending.map((c) => c.contractor), ['Bob'])
})

test('payableInvoicesByContractor: factura Invoiced con TODOS pagos (aún no flipeada) se excluye (sin pendientes)', () => {
  // Estado transitorio: derivado Paid pero la RPC todavía no escribió status. No hay
  // nada que pagar, así que no aparece en la lista de pagables.
  const invoices = [invoice('i1', 'Invoiced', '2026-08-10')]
  const byInv = new Map([['i1', [contractor('Ana', [1], 4)]]])
  const out = payableInvoicesByContractor(invoices, byInv, [payment([1])])
  assert.deepEqual(out, [])
})

test('payableInvoicesByContractor: factura sin contractors cargados se excluye (nada que pagar)', () => {
  const invoices = [invoice('i1', 'Invoiced', '2026-08-10')]
  const out = payableInvoicesByContractor(invoices, new Map(), [])
  assert.deepEqual(out, [])
})

test('payableInvoicesByContractor: ordena por fecha ascendente (la más vieja primero)', () => {
  const invoices = [
    invoice('nueva', 'Invoiced', '2026-08-20'),
    invoice('vieja', 'Invoiced', '2026-08-01'),
  ]
  const byInv = new Map([
    ['nueva', [contractor('Ana', [1], 4)]],
    ['vieja', [contractor('Bob', [2], 3)]],
  ])
  const out = payableInvoicesByContractor(invoices, byInv, [])
  assert.deepEqual(out.map((r) => r.invoice.id), ['vieja', 'nueva'])
})

test('payableInvoicesByContractor: acepta contractorsByInvoice como objeto plano, no sólo Map', () => {
  const invoices = [invoice('i1', 'Invoiced', '2026-08-10')]
  const byInv = { i1: [contractor('Ana', [1], 4)] }
  const [row] = payableInvoicesByContractor(invoices, byInv, [])
  assert.equal(row.pending.length, 1)
})

test('payableInvoicesByContractor: Map keyed por number con invoice.id string → matchea igual', () => {
  const invoices = [invoice('5', 'Invoiced', '2026-08-10')] // id string
  const byInv = new Map([[5, [contractor('Ana', [1], 4)]]]) // Map keyed por number
  const [row] = payableInvoicesByContractor(invoices, byInv, [])
  assert.equal(row.pending.length, 1)
})

test('payableInvoicesByContractor: factura sin fecha va al FONDO, no como la más vieja', () => {
  const invoices = [
    invoice('sinfecha', 'Invoiced', null),
    invoice('vieja', 'Invoiced', '2026-08-01'),
  ]
  const byInv = new Map([
    ['sinfecha', [contractor('Ana', [1], 4)]],
    ['vieja', [contractor('Bob', [2], 3)]],
  ])
  const out = payableInvoicesByContractor(invoices, byInv, [])
  assert.deepEqual(out.map((r) => r.invoice.id), ['vieja', 'sinfecha'])
})

test('payableInvoicesByContractor: desempate por id es numérico (2 antes de 10)', () => {
  const invoices = [
    invoice(10, 'Invoiced', '2026-08-10'),
    invoice(2, 'Invoiced', '2026-08-10'),
  ]
  const byInv = new Map([
    [10, [contractor('Ana', [1], 4)]],
    [2, [contractor('Bob', [2], 3)]],
  ])
  const out = payableInvoicesByContractor(invoices, byInv, [])
  assert.deepEqual(out.map((r) => r.invoice.id), [2, 10])
})

test('payableInvoicesByContractor: entradas nulas → []', () => {
  assert.deepEqual(payableInvoicesByContractor(undefined, undefined, undefined), [])
})

// --- Cobertura PARCIAL por contractor (pago parcial por período) --------------------
test('invoiceCompletion: cobertura parcial de una línea → paidHours preciso + unpaidEntryIds', () => {
  const contractors = [contractor('Ana', [1, 2, 3], 10)]
  const hoursByEntryId = { 1: 2, 2: 3, 3: 5 } // total 10
  const payments = [payment([1, 2])] // cubre 2+3 = 5h; falta la 3 (5h)
  const out = invoiceCompletion(contractors, payments, hoursByEntryId)
  const ana = out.contractors[0]
  assert.equal(ana.paid, false) // no todas cubiertas
  assert.equal(ana.paidHours, 5) // 2h + 3h (entries 1 y 2)
  assert.deepEqual(ana.unpaidEntryIds, ['3'])
  assert.equal(out.status, 'partial')
  assert.equal(out.paidHours, 5) // agregado incluye el parcial
})

test('invoiceCompletion: cobertura TOTAL de la línea → paid, unpaidEntryIds vacío, paidHours=total', () => {
  const contractors = [contractor('Ana', [1, 2, 3], 10)]
  const hoursByEntryId = { 1: 2, 2: 3, 3: 5 }
  const out = invoiceCompletion(contractors, [payment([1, 2, 3])], hoursByEntryId)
  const ana = out.contractors[0]
  assert.equal(ana.paid, true)
  assert.deepEqual(ana.unpaidEntryIds, [])
  assert.equal(ana.paidHours, 10)
  assert.equal(out.status, 'Paid')
})

test('invoiceCompletion: paymentId (pago línea entera sin entry_ids) → paid, sin pendientes', () => {
  // El pago por factura viejo deja entry_ids NULL; la línea trae paymentId. Debe contar paga.
  const contractors = [{ contractor: 'Ana', entryIds: [1, 2], hours: 8, paymentId: 'pay-1' }]
  const out = invoiceCompletion(contractors, [], { 1: 4, 2: 4 })
  const ana = out.contractors[0]
  assert.equal(ana.paid, true)
  assert.deepEqual(ana.unpaidEntryIds, [])
  assert.equal(ana.paidHours, 8)
})

test('invoiceCompletion: sin hoursByEntryId, paidHours parcial se prorratea sobre el total', () => {
  const contractors = [contractor('Ana', [1, 2, 3, 4], 12)] // 3h por entry (prorrateo)
  const out = invoiceCompletion(contractors, [payment([1, 2])]) // 2 de 4 cubiertos
  const ana = out.contractors[0]
  assert.equal(ana.paid, false)
  assert.equal(ana.paidHours, 6) // 12 * 2/4
  assert.deepEqual(ana.unpaidEntryIds, ['3', '4'])
})

test('invoiceCompletion: hoursByEntryId como Map de claves NUMÉRICAS → paidHours exacto', () => {
  const contractors = [contractor('Ana', [1, 2, 3], 10)]
  const hoursByEntryId = new Map([[1, 2], [2, 3], [3, 5]]) // claves number
  const out = invoiceCompletion(contractors, [payment([1, 2])], hoursByEntryId)
  assert.equal(out.contractors[0].paidHours, 5) // 2 + 3, no 0
  assert.equal(out.paidHours, 5)
})

test('invoiceCompletion: paymentId + cobertura PARCIAL por entry_ids → manda la cobertura (no oculta lo pendiente)', () => {
  // Aunque la fila traiga paymentId, si hay cobertura parcial por entry_ids la línea NO se da
  // por entera paga: se muestran las horas que faltan (ADR 0005, paymentId vestigial en parcial).
  const contractors = [{ contractor: 'Ana', entryIds: [1, 2, 3], hours: 9, paymentId: 'pay-x' }]
  const hoursByEntryId = { 1: 3, 2: 3, 3: 3 }
  const out = invoiceCompletion(contractors, [payment([1])], hoursByEntryId) // sólo la 1 cubierta
  const ana = out.contractors[0]
  assert.equal(ana.paid, false)
  assert.deepEqual(ana.unpaidEntryIds, ['2', '3'])
  assert.equal(ana.paidHours, 3)
})

test('invoiceCompletion: paidHours parcial se capa a las horas de la línea (por-entry no suma exacto)', () => {
  // hoursByEntryId puede no sumar exacto a la hours de la línea (redondeos); el parcial no
  // debe superar el total de la línea (progreso > 100%).
  const contractors = [contractor('Ana', [1, 2, 3], 10)]
  const hoursByEntryId = { 1: 6, 2: 6, 3: 1 } // suma 13, línea 10
  const out = invoiceCompletion(contractors, [payment([1, 2])], hoursByEntryId) // cubre 12 crudo
  assert.equal(out.contractors[0].paid, false)
  assert.equal(out.contractors[0].paidHours, 10) // capado a lineHours, no 12
})

test('invoiceCompletion: línea con entry_ids repetidos y NADA pago → Invoiced (no partial)', () => {
  const contractors = [contractor('Ana', [1, 1], 8)] // id repetido, defensivo
  const out = invoiceCompletion(contractors, [])
  assert.equal(out.status, 'Invoiced')
  assert.equal(out.paidHours, 0)
  assert.equal(out.contractors[0].paid, false)
})

test('invoiceCompletion: entry cubierto ausente del hoursByEntryId cae al promedio de la línea', () => {
  const contractors = [contractor('Ana', [1, 2, 3, 4], 12)] // avg 3/entry
  const hoursByEntryId = { 1: 5 } // faltan 2,3,4
  const out = invoiceCompletion(contractors, [payment([1, 2])], hoursByEntryId) // cubre 1 y 2
  // 1 → 5 (exacto); 2 → 3 (promedio). Total 8, bajo el cap (12).
  assert.equal(out.contractors[0].paidHours, 8)
})
