import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBudgetSavePlan } from './budgetEditorPlan.js'

test('sin stages: cambiar el base budget produce baseBudgetChange', () => {
  const original = { hasStages: false, baseBudgetHours: 120, activeStageId: null, stages: [] }
  const edited = { baseBudgetInput: '200', activeStageId: null, stageInputs: {} }
  const { error, baseBudgetChange, stageBudgetChanges, activeStageChange } = buildBudgetSavePlan(original, edited)
  assert.equal(error, null)
  assert.deepEqual(baseBudgetChange, { value: 200 })
  assert.deepEqual(stageBudgetChanges, [])
  assert.equal(activeStageChange, null)
})

test('sin stages: base inválido devuelve error y ningún cambio', () => {
  const original = { hasStages: false, baseBudgetHours: 120, activeStageId: null, stages: [] }
  const { error, baseBudgetChange } = buildBudgetSavePlan(original, { baseBudgetInput: 'abc' })
  assert.ok(error)
  assert.equal(baseBudgetChange, null)
})

test('sin stages: mismo valor no genera cambio (no-op)', () => {
  const original = { hasStages: false, baseBudgetHours: 120, activeStageId: null, stages: [] }
  const plan = buildBudgetSavePlan(original, { baseBudgetInput: '120' })
  assert.equal(plan.error, null)
  assert.equal(plan.baseBudgetChange, null)
})

test('sin stages: vaciar el base lo cambia a null', () => {
  const original = { hasStages: false, baseBudgetHours: 120, activeStageId: null, stages: [] }
  const plan = buildBudgetSavePlan(original, { baseBudgetInput: '' })
  assert.deepEqual(plan.baseBudgetChange, { value: null })
})

test('sin stages: baseBudgetInput ausente es no-op, NO borra el budget', () => {
  const original = { hasStages: false, baseBudgetHours: 120, activeStageId: null, stages: [] }
  const plan = buildBudgetSavePlan(original, {})
  assert.equal(plan.error, null)
  assert.equal(plan.baseBudgetChange, null)
})

test('con stages: solo los stages con budget cambiado entran al plan', () => {
  const original = {
    hasStages: true,
    baseBudgetHours: null,
    activeStageId: 1,
    stages: [
      { id: 1, budgetHours: 100 },
      { id: 2, budgetHours: 60 },
      { id: 3, budgetHours: null },
    ],
  }
  const edited = {
    activeStageId: 1,
    stageInputs: { 1: '100', 2: '80', 3: '40' }, // stage 1 igual; 2 y 3 cambian
  }
  const plan = buildBudgetSavePlan(original, edited)
  assert.equal(plan.error, null)
  assert.equal(plan.baseBudgetChange, null)
  assert.deepEqual(plan.stageBudgetChanges, [
    { id: 2, from: 60, value: 80 },
    { id: 3, from: null, value: 40 },
  ])
  assert.equal(plan.activeStageChange, null)
})

test('con stages: cambiar el stage activo produce activeStageChange', () => {
  const original = {
    hasStages: true,
    baseBudgetHours: null,
    activeStageId: 1,
    stages: [
      { id: 1, budgetHours: 100 },
      { id: 2, budgetHours: 60 },
    ],
  }
  const plan = buildBudgetSavePlan(original, {
    activeStageId: 2,
    stageInputs: { 1: '100', 2: '60' },
  })
  assert.deepEqual(plan.activeStageChange, { value: 2 })
  assert.deepEqual(plan.stageBudgetChanges, [])
})

test('con stages: vaciar el budget de un stage lo cambia a null', () => {
  const original = {
    hasStages: true,
    baseBudgetHours: null,
    activeStageId: 1,
    stages: [{ id: 1, budgetHours: 50 }],
  }
  const plan = buildBudgetSavePlan(original, { activeStageId: 1, stageInputs: { 1: '' } })
  assert.deepEqual(plan.stageBudgetChanges, [{ id: 1, from: 50, value: null }])
})

test('con stages: budget de stage inválido devuelve error', () => {
  const original = {
    hasStages: true,
    baseBudgetHours: null,
    activeStageId: 1,
    stages: [{ id: 1, budgetHours: 50 }],
  }
  const plan = buildBudgetSavePlan(original, { activeStageId: 1, stageInputs: { 1: '-5' } })
  assert.ok(plan.error)
  assert.deepEqual(plan.stageBudgetChanges, [])
})
