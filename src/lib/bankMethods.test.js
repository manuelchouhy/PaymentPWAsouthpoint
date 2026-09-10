import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BANK_METHODS } from './bankMethods.js'

test('BANK_METHODS incluye "Prex"', () => {
  assert.ok(BANK_METHODS.includes('Prex'))
})

test("BANK_METHODS mantiene 'Other' último como catch-all", () => {
  assert.equal(BANK_METHODS.at(-1), 'Other')
})

test('BANK_METHODS no tiene duplicados', () => {
  assert.equal(new Set(BANK_METHODS).size, BANK_METHODS.length)
})
