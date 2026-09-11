import { test } from 'node:test'
import assert from 'node:assert/strict'
import { invoiceByEntryId } from './invoiceIndex.js'

test('mapea cada entryId (como String) a su factura', () => {
  const inv1 = { id: 'i1', entryIds: [1, 2] }
  const inv2 = { id: 'i2', entryIds: ['3'] }
  const map = invoiceByEntryId([inv1, inv2])
  assert.equal(map.get('1'), inv1)
  assert.equal(map.get('2'), inv1)
  assert.equal(map.get('3'), inv2)
  assert.equal(map.size, 3)
})

test('coacciona los ids numéricos a String (para .has(String(entry.id)))', () => {
  const map = invoiceByEntryId([{ id: 'i', entryIds: [42] }])
  assert.ok(map.has('42'))
  assert.ok(!map.has(42)) // la clave es el string, no el número
})

test('tolera facturas sin entryIds y lista vacía/undefined', () => {
  assert.equal(invoiceByEntryId([{ id: 'i' }]).size, 0)
  assert.equal(invoiceByEntryId([]).size, 0)
  assert.equal(invoiceByEntryId().size, 0)
})

test('la última factura gana si dos cubren la misma hora', () => {
  const a = { id: 'a', entryIds: [7] }
  const b = { id: 'b', entryIds: [7] }
  assert.equal(invoiceByEntryId([a, b]).get('7'), b)
})
