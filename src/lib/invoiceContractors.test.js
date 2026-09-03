import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildGroupedInvoicePayload } from './invoiceContractors.js'

// Helper: una selección válida mínima, se sobreescribe lo que haga falta.
const base = () => ({
  spInvoiceNumber: 'SP-001',
  project: 'P1',
  client: 'HSS',
  weekStart: '2026-08-09',
  contractors: [
    { contractor: 'Ana', entries: [{ id: 1, hours: 4 }, { id: 2, hours: 2 }] },
    { contractor: 'Bob', entries: [{ id: 3, hours: 3 }] },
  ],
  notes: 'nota',
})

test('arma invoice + filas por contractor con horas y entry_ids', () => {
  const { invoice, contractorRows } = buildGroupedInvoicePayload(base())

  // Invoice: sp number, unidad facturable y union de entry_ids (denormalizado).
  assert.equal(invoice.sp_invoice_number, 'SP-001')
  assert.equal(invoice.project, 'P1')
  assert.equal(invoice.client, 'HSS')
  assert.equal(invoice.week_start, '2026-08-09')
  assert.equal(invoice.status, 'Invoiced')
  assert.equal(invoice.notes, 'nota')
  assert.deepEqual([...invoice.entry_ids].sort((a, b) => a - b), [1, 2, 3])

  // Una fila por contractor, con su suma de horas y sus entry_ids.
  assert.equal(contractorRows.length, 2)
  const ana = contractorRows.find((r) => r.contractor === 'Ana')
  const bob = contractorRows.find((r) => r.contractor === 'Bob')
  assert.equal(ana.hours, 6)
  assert.deepEqual(ana.entry_ids, [1, 2])
  assert.equal(bob.hours, 3)
  assert.deepEqual(bob.entry_ids, [3])
})

test('factura multi-semana: guarda week_end (rango del período)', () => {
  const { invoice } = buildGroupedInvoicePayload({
    ...base(),
    weekStart: '2026-08-02',
    weekEnd: '2026-08-09',
  })
  assert.equal(invoice.week_start, '2026-08-02')
  assert.equal(invoice.week_end, '2026-08-09')
})

test('factura de una sola semana: sin weekEnd → week_end null', () => {
  const { invoice } = buildGroupedInvoicePayload(base()) // base() no trae weekEnd
  assert.equal(invoice.week_start, '2026-08-09')
  assert.equal(invoice.week_end, null)
})

test('factura de una sola semana: weekEnd === weekStart → week_end null (marcador de multi-semana inequívoco)', () => {
  const { invoice } = buildGroupedInvoicePayload({
    ...base(),
    weekStart: '2026-08-09',
    weekEnd: '2026-08-09',
  })
  assert.equal(invoice.week_start, '2026-08-09')
  assert.equal(invoice.week_end, null)
})

test('week_end incoherente se degrada a null: rango invertido y end sin start', () => {
  // Rango invertido (weekEnd anterior a weekStart): no se guarda como rango.
  const reversed = buildGroupedInvoicePayload({
    ...base(),
    weekStart: '2026-08-09',
    weekEnd: '2026-08-02',
  }).invoice
  assert.equal(reversed.week_start, '2026-08-09')
  assert.equal(reversed.week_end, null)
  // End sin start (weekStart ausente): week_start null y week_end null (no un end huérfano).
  const noStart = buildGroupedInvoicePayload({
    ...base(),
    weekStart: undefined,
    weekEnd: '2026-08-23',
  }).invoice
  assert.equal(noStart.week_start, null)
  assert.equal(noStart.week_end, null)
})

test('entry_ids no numéricos se descartan (bigint[] en Supabase)', () => {
  const { invoice, contractorRows } = buildGroupedInvoicePayload({
    ...base(),
    contractors: [{ contractor: 'Ana', entries: [{ id: '5', hours: 1 }, { id: 'x', hours: 1 }] }],
  })
  assert.deepEqual(contractorRows[0].entry_ids, [5])
  assert.deepEqual(invoice.entry_ids, [5])
  // Horas atadas a las entries incluidas: la del id descartado NO se cuenta.
  assert.equal(contractorRows[0].hours, 1)
})

test('spInvoiceNumber vacío o en blanco es error legible', () => {
  for (const spInvoiceNumber of ['', '   ', undefined]) {
    assert.throws(
      () => buildGroupedInvoicePayload({ ...base(), spInvoiceNumber }),
      /SP invoice number/i,
    )
  }
})

test('proyecto requerido', () => {
  assert.throws(() => buildGroupedInvoicePayload({ ...base(), project: '' }), /project/i)
})

test('al menos un contractor', () => {
  assert.throws(() => buildGroupedInvoicePayload({ ...base(), contractors: [] }), /contractor/i)
})

test('un contractor sin horas seleccionadas es error', () => {
  assert.throws(
    () =>
      buildGroupedInvoicePayload({
        ...base(),
        contractors: [{ contractor: 'Ana', entries: [] }],
      }),
    /Ana/,
  )
})

test('una hora no puede pertenecer a dos contractors (no solape entre filas)', () => {
  assert.throws(
    () =>
      buildGroupedInvoicePayload({
        ...base(),
        contractors: [
          { contractor: 'Ana', entries: [{ id: 1, hours: 1 }] },
          { contractor: 'Bob', entries: [{ id: 1, hours: 1 }] },
        ],
      }),
    /overlap|already/i,
  )
})

test('un entry incluido sin horas válidas es error (hours ↔ entry_ids consistentes)', () => {
  // null/undefined (dato ausente) y lo que coerciona a NaN son inválidos; 0 sí es
  // válido (se cubre en otro test vía las entries de base()).
  for (const hours of [undefined, null, NaN, 'abc']) {
    assert.throws(
      () =>
        buildGroupedInvoicePayload({
          ...base(),
          contractors: [{ contractor: 'Ana', entries: [{ id: 7, hours }] }],
        }),
      /Entry 7 .*Ana.*valid hours/i,
    )
  }
})

test('0 horas es un valor válido (no se rechaza como ausente)', () => {
  const { contractorRows } = buildGroupedInvoicePayload({
    ...base(),
    contractors: [{ contractor: 'Ana', entries: [{ id: 9, hours: 0 }] }],
  })
  assert.deepEqual(contractorRows[0].entry_ids, [9])
  assert.equal(contractorRows[0].hours, 0)
})

test('entry_ids repetidos dentro de un contractor se deduplican', () => {
  const { contractorRows, invoice } = buildGroupedInvoicePayload({
    ...base(),
    contractors: [{ contractor: 'Ana', entries: [{ id: 1, hours: 1 }, { id: 1, hours: 1 }] }],
  })
  assert.deepEqual(contractorRows[0].entry_ids, [1])
  assert.deepEqual(invoice.entry_ids, [1])
  // La hora repetida se cuenta una sola vez (hours atado a entry_ids deduplicado).
  assert.equal(contractorRows[0].hours, 1)
})
