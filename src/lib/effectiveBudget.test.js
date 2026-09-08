import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effectiveBudgetHours } from './effectiveBudget.js'

test('null base → null (proyecto sin presupuesto)', () => {
  assert.equal(effectiveBudgetHours(null, []), null)
})

test('suma solo los expand_budget aprobados', () => {
  const crs = [
    { status: 'approved', type: 'expand_budget', deltaHours: 40 },
    { status: 'approved', type: 'write_off_overage', deltaHours: 10 },
    { status: 'pending', type: 'expand_budget', deltaHours: 100 },
    { status: 'rejected', type: 'expand_budget', deltaHours: 100 },
  ]
  assert.equal(effectiveBudgetHours(120, crs), 160)
})

test('base sin change requests devuelve la base', () => {
  assert.equal(effectiveBudgetHours(120, []), 120)
})

test('un deltaHours no numérico aporta 0, no envenena con NaN', () => {
  const crs = [
    { status: 'approved', type: 'expand_budget', deltaHours: null },
    { status: 'approved', type: 'expand_budget', deltaHours: 30 },
  ]
  assert.equal(effectiveBudgetHours(120, crs), 150)
})
