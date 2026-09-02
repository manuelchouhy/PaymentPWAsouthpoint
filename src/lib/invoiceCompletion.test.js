import { test } from 'node:test'
import assert from 'node:assert/strict'
import { invoiceCompletion } from './invoiceCompletion.js'

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
  // Ana tiene [1,2]; un pago cubre sólo 1. No está pagada hasta cubrir TODAS.
  const contractors = [contractor('Ana', [1, 2], 8)]
  const out = invoiceCompletion(contractors, [payment([1])])
  assert.equal(out.status, 'Invoiced')
  assert.equal(out.paidCount, 0)
  assert.equal(out.contractors[0].paid, false)
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
