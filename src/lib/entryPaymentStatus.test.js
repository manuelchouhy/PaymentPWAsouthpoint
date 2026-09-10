import { test } from 'node:test'
import assert from 'node:assert/strict'
import { entryPaymentStatus } from './entryPaymentStatus.js'

test('entryPaymentStatus: id en el set de pagadas → "paid"', () => {
  const paid = new Set(['1', '2'])
  assert.equal(entryPaymentStatus({ id: '1' }, paid), 'paid')
})

test('entryPaymentStatus: id fuera del set → "pending"', () => {
  assert.equal(entryPaymentStatus({ id: '9' }, new Set(['1', '2'])), 'pending')
})

test('entryPaymentStatus: entry.id numérico se compara como string', () => {
  assert.equal(entryPaymentStatus({ id: 1 }, new Set(['1'])), 'paid')
})

test('entryPaymentStatus: set vacío / ausente → "pending"', () => {
  assert.equal(entryPaymentStatus({ id: '1' }, new Set()), 'pending')
  assert.equal(entryPaymentStatus({ id: '1' }, undefined), 'pending')
})
