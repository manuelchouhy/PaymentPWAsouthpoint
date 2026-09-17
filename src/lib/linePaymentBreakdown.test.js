import { test } from 'node:test'
import assert from 'node:assert/strict'
import { linePaymentBreakdown } from './linePaymentBreakdown.js'

const hoursMap = (obj) => new Map(Object.entries(obj).map(([k, v]) => [String(k), v]))

test('linePaymentBreakdown: un solo pago que cubre toda la línea → 1 fila con las horas completas', () => {
  const ic = { entryIds: [1, 2, 3], hours: 10 }
  const payments = [
    { id: 'p1', entryIds: [1, 2, 3], supplierInvoiceNumber: 'SUP-1', paymentDate: '2026-09-10' },
  ]
  const out = linePaymentBreakdown(ic, payments, hoursMap({ 1: 4, 2: 4, 3: 2 }))
  assert.equal(out.length, 1)
  assert.deepEqual(out[0], {
    id: 'p1',
    supplierInvoiceNumber: 'SUP-1',
    paymentDate: '2026-09-10',
    createdAt: null,
    hours: 10,
  })
})

test('linePaymentBreakdown: dos parciales → 2 filas, cada una con sus horas, ordenadas por fecha', () => {
  const ic = { entryIds: [1, 2, 3, 4], hours: 14 }
  const payments = [
    { id: 'pB', entryIds: [3, 4], supplierInvoiceNumber: 'SUP-B', paymentDate: '2026-09-20' },
    { id: 'pA', entryIds: [1, 2], supplierInvoiceNumber: 'SUP-A', paymentDate: '2026-09-10' },
  ]
  const out = linePaymentBreakdown(ic, payments, hoursMap({ 1: 4, 2: 4, 3: 3, 4: 3 }))
  assert.deepEqual(
    out.map((r) => ({ id: r.id, hours: r.hours })),
    [
      { id: 'pA', hours: 8 },
      { id: 'pB', hours: 6 },
    ],
  )
})

test('linePaymentBreakdown: sólo cuenta la intersección con la línea (ignora horas de otras líneas)', () => {
  const ic = { entryIds: [1, 2], hours: 10 }
  // El pago cubre 1,2 (de esta línea) y 9 (de otra línea/factura).
  const payments = [{ id: 'p1', entryIds: [1, 2, 9], paymentDate: '2026-09-10' }]
  const out = linePaymentBreakdown(ic, payments, hoursMap({ 1: 5, 2: 5, 9: 100 }))
  assert.equal(out.length, 1)
  assert.equal(out[0].hours, 10)
})

test('linePaymentBreakdown: pagos que no tocan la línea no aparecen', () => {
  const ic = { entryIds: [1, 2], hours: 8 }
  const payments = [{ id: 'other', entryIds: [7, 8], paymentDate: '2026-09-10' }]
  assert.deepEqual(linePaymentBreakdown(ic, payments, hoursMap({})), [])
})

test('linePaymentBreakdown: pago LEGACY sin entry_ids → sin filas (no reconstruible)', () => {
  const ic = { entryIds: [1, 2], hours: 8 }
  const payments = [{ id: 'legacy', entryIds: [], supplierInvoiceNumber: 'SUP-OLD', paymentDate: '2026-09-01' }]
  assert.deepEqual(linePaymentBreakdown(ic, payments, hoursMap({ 1: 4, 2: 4 })), [])
})

test('linePaymentBreakdown: desempata por createdAt entre pagos del mismo día', () => {
  const ic = { entryIds: [1, 2], hours: 2 }
  const payments = [
    { id: 'late', entryIds: [2], paymentDate: '2026-09-10', createdAt: '2026-09-10T18:00:00Z' },
    { id: 'early', entryIds: [1], paymentDate: '2026-09-10', createdAt: '2026-09-10T09:00:00Z' },
  ]
  const out = linePaymentBreakdown(ic, payments, hoursMap({ 1: 1, 2: 1 }))
  assert.deepEqual(out.map((r) => r.id), ['early', 'late'])
})

test('linePaymentBreakdown: entry cubierto AUSENTE del snapshot cae al promedio de la línea (no 0)', () => {
  // Consistente con invoiceCompletion: un pago real nunca debe mostrar 0 h por falta de snapshot.
  const ic = { entryIds: [1, 2], hours: 8 } // avg = 4/entry
  const payments = [{ id: 'p1', entryIds: [1, 2], paymentDate: '2026-09-10' }]
  const out = linePaymentBreakdown(ic, payments, hoursMap({ 1: 5 })) // 2 ausente → avg 4
  assert.equal(out[0].hours, 9)
})

test('linePaymentBreakdown: sin hoursByEntryId prorratea por el promedio de la línea', () => {
  const ic = { entryIds: [1, 2], hours: 10 }
  const payments = [{ id: 'p1', entryIds: [1, 2], paymentDate: '2026-09-10' }]
  const out = linePaymentBreakdown(ic, payments)
  assert.equal(out[0].hours, 10)
})

test('linePaymentBreakdown: línea sin entryIds → []', () => {
  assert.deepEqual(linePaymentBreakdown({ entryIds: [] }, [{ id: 'p', entryIds: [1] }]), [])
  assert.deepEqual(linePaymentBreakdown({}, [{ id: 'p', entryIds: [1] }]), [])
})

test('linePaymentBreakdown: ids string vs number coinciden (coerción a String)', () => {
  const ic = { entryIds: ['1', 2], hours: 6 }
  const payments = [{ id: 'p1', entryIds: [1, '2'], paymentDate: '2026-09-10' }]
  const out = linePaymentBreakdown(ic, payments, hoursMap({ 1: 3, 2: 3 }))
  assert.equal(out.length, 1)
  assert.equal(out[0].hours, 6)
})
