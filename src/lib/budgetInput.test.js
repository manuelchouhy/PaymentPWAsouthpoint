import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseBudgetInput } from './budgetInput.js'

test('número válido → value, sin error', () => {
  assert.deepEqual(parseBudgetInput('150', { allowEmpty: true, allowZero: true }), {
    value: 150,
    error: null,
  })
})

test('vacío con allowEmpty → value null, sin error', () => {
  assert.deepEqual(parseBudgetInput('', { allowEmpty: true, allowZero: true }), {
    value: null,
    error: null,
  })
})

test('vacío sin allowEmpty → error (requerido, caso wizard)', () => {
  const res = parseBudgetInput('', { allowEmpty: false, allowZero: false })
  assert.equal(res.value, null)
  assert.ok(res.error)
})

test('negativo → error', () => {
  const res = parseBudgetInput('-5', { allowEmpty: true, allowZero: true })
  assert.equal(res.value, null)
  assert.ok(res.error)
})

test('no numérico → error', () => {
  const res = parseBudgetInput('abc', { allowEmpty: true, allowZero: true })
  assert.equal(res.value, null)
  assert.ok(res.error)
})

test('cero con allowZero → válido (corrección, caso form)', () => {
  assert.deepEqual(parseBudgetInput('0', { allowEmpty: true, allowZero: true }), {
    value: 0,
    error: null,
  })
})

test('cero sin allowZero → error (debe ser > 0, caso wizard)', () => {
  const res = parseBudgetInput('0', { allowEmpty: false, allowZero: false })
  assert.equal(res.value, null)
  assert.ok(res.error)
})

test('decimal válido → value', () => {
  assert.deepEqual(parseBudgetInput('2.5', { allowEmpty: true, allowZero: true }), {
    value: 2.5,
    error: null,
  })
})

test('null/undefined se tratan como vacío', () => {
  assert.deepEqual(parseBudgetInput(null, { allowEmpty: true, allowZero: true }), {
    value: null,
    error: null,
  })
  assert.deepEqual(parseBudgetInput(undefined, { allowEmpty: true, allowZero: true }), {
    value: null,
    error: null,
  })
})

test('espacios alrededor de un número → value', () => {
  assert.deepEqual(parseBudgetInput('  40  ', { allowEmpty: true, allowZero: true }), {
    value: 40,
    error: null,
  })
})
