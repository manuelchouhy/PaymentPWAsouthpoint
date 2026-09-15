import { test } from 'node:test'
import assert from 'node:assert/strict'
import { remainingBudgetHours } from './budgetRemaining.js'

test('budget null → null (sin proyecto único o sin budget cargado)', () => {
  assert.equal(remainingBudgetHours({ budget: null, consumed: 40 }), null)
})

test('sin argumentos → null (defensivo)', () => {
  assert.equal(remainingBudgetHours(), null)
})

test('remaining = budget − consumed', () => {
  assert.equal(remainingBudgetHours({ budget: 120, consumed: 80 }), 40)
})

test('consumido > budget → negativo (over budget), no se clampea a 0', () => {
  assert.equal(remainingBudgetHours({ budget: 100, consumed: 130 }), -30)
})

test('consumed ausente cuenta como 0', () => {
  assert.equal(remainingBudgetHours({ budget: 100 }), 100)
})

test('consumed no numérico aporta 0, no NaN', () => {
  assert.equal(remainingBudgetHours({ budget: 100, consumed: 'x' }), 100)
})

test('budget 0 es válido (no null): remaining = -consumed', () => {
  assert.equal(remainingBudgetHours({ budget: 0, consumed: 10 }), -10)
})

test('budget no numérico → null', () => {
  assert.equal(remainingBudgetHours({ budget: 'x', consumed: 10 }), null)
})
