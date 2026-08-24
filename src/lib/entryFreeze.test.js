import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isEntryFrozen, entryFrozenReason } from './entryFreeze.js'

const invoiced = new Set(['1'])
const paid = new Set(['2'])

test('congela una hora facturada', () => {
  assert.equal(isEntryFrozen({ id: 1 }, { invoicedEntryIds: invoiced, paidEntryIds: paid }), true)
})

test('congela una hora pagada (overage)', () => {
  assert.equal(isEntryFrozen({ id: 2 }, { invoicedEntryIds: invoiced, paidEntryIds: paid }), true)
})

test('congela si está facturada Y pagada', () => {
  const both = { invoicedEntryIds: new Set(['3']), paidEntryIds: new Set(['3']) }
  assert.equal(isEntryFrozen({ id: 3 }, both), true)
})

test('NO congela una hora sin factura ni pago', () => {
  assert.equal(isEntryFrozen({ id: 9 }, { invoicedEntryIds: invoiced, paidEntryIds: paid }), false)
})

test('id number o string matchea igual (el Set guarda strings)', () => {
  assert.equal(isEntryFrozen({ id: 1 }, { invoicedEntryIds: new Set(['1']) }), true)
  assert.equal(isEntryFrozen({ id: '1' }, { invoicedEntryIds: new Set(['1']) }), true)
})

test('sin opts / sin entry → no congela (falla-abierta, se puede clasificar)', () => {
  assert.equal(isEntryFrozen({ id: 1 }), false)
  assert.equal(isEntryFrozen(null, { invoicedEntryIds: invoiced }), false)
})

test('entryFrozenReason distingue factura vs pago (invoiced tiene precedencia)', () => {
  const opts = { invoicedEntryIds: invoiced, paidEntryIds: paid }
  assert.equal(entryFrozenReason({ id: 1 }, opts), 'invoiced')
  assert.equal(entryFrozenReason({ id: 2 }, opts), 'paid')
  assert.equal(entryFrozenReason({ id: 9 }, opts), null)
  // Facturada Y pagada → 'invoiced' (precedencia estable).
  const both = { invoicedEntryIds: new Set(['3']), paidEntryIds: new Set(['3']) }
  assert.equal(entryFrozenReason({ id: 3 }, both), 'invoiced')
  assert.equal(entryFrozenReason(null, opts), null)
})
