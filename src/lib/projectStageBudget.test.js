import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveProjectBudget } from './projectStageBudget.js'

test('sin stages: active y total = base del proyecto', () => {
  const project = { baseBudgetHours: 120, activeStageId: null }
  const result = resolveProjectBudget(project, [], [])
  assert.equal(result.hasStages, false)
  assert.equal(result.activeBudget, 120)
  assert.equal(result.totalBudget, 120)
})

test('sin stages y base null: active y total null', () => {
  const project = { baseBudgetHours: null, activeStageId: null }
  const result = resolveProjectBudget(project, [], [])
  assert.equal(result.activeBudget, null)
  assert.equal(result.totalBudget, null)
})

test('sin stages: los expand_budget aprobados suman a active y total', () => {
  const project = { baseBudgetHours: 120, activeStageId: null }
  const crs = [
    { status: 'approved', type: 'expand_budget', deltaHours: 40 },
    { status: 'pending', type: 'expand_budget', deltaHours: 100 },
  ]
  const result = resolveProjectBudget(project, [], crs)
  assert.equal(result.activeBudget, 160)
  assert.equal(result.totalBudget, 160)
})

test('con stages y uno activo: total = suma, active = budget del activo', () => {
  const project = { baseBudgetHours: 500, activeStageId: 2 }
  const stages = [
    { id: 1, budgetHours: 100 },
    { id: 2, budgetHours: 60 },
    { id: 3, budgetHours: 40 },
  ]
  const result = resolveProjectBudget(project, stages, [])
  assert.equal(result.hasStages, true)
  assert.equal(result.activeStageId, 2)
  assert.equal(result.totalBudget, 200)
  assert.equal(result.activeBudget, 60)
})

test('con stages: los CRs aprobados suman al activo pero NO al total (suma pura de stages)', () => {
  const project = { baseBudgetHours: null, activeStageId: 2 }
  const stages = [
    { id: 1, budgetHours: 100 },
    { id: 2, budgetHours: 60 },
  ]
  const crs = [{ status: 'approved', type: 'expand_budget', deltaHours: 15 }]
  const result = resolveProjectBudget(project, stages, crs)
  assert.equal(result.activeBudget, 75) // 60 (activo) + 15 (CR)
  assert.equal(result.totalBudget, 160) // 100 + 60, sin CRs — reconcilia con la grilla
})

test('con stages y ninguno activo: active null, total = suma', () => {
  const project = { baseBudgetHours: 500, activeStageId: null }
  const stages = [
    { id: 1, budgetHours: 100 },
    { id: 2, budgetHours: 60 },
  ]
  const result = resolveProjectBudget(project, stages, [])
  assert.equal(result.hasStages, true)
  assert.equal(result.activeBudget, null)
  assert.equal(result.totalBudget, 160)
})

test('activeStageId que no matchea ningún stage se trata como ninguno activo', () => {
  const project = { baseBudgetHours: 500, activeStageId: 999 }
  const stages = [{ id: 1, budgetHours: 100 }]
  const result = resolveProjectBudget(project, stages, [])
  assert.equal(result.activeBudget, null)
  assert.equal(result.totalBudget, 100)
})

test('total ignora budgets null pero cuenta el 0', () => {
  const project = { baseBudgetHours: null, activeStageId: 3 }
  const stages = [
    { id: 1, budgetHours: null },
    { id: 2, budgetHours: 80 },
    { id: 3, budgetHours: 0 },
  ]
  const result = resolveProjectBudget(project, stages, [])
  assert.equal(result.totalBudget, 80)
  assert.equal(result.activeBudget, 0)
})

test("budgetHours '' se trata como sin cargar (no como 0)", () => {
  const project = { baseBudgetHours: null, activeStageId: 1 }
  const stages = [
    { id: 1, budgetHours: '' },
    { id: 2, budgetHours: 50 },
  ]
  const result = resolveProjectBudget(project, stages, [])
  assert.equal(result.totalBudget, 50) // el '' del stage 1 no suma como 0
  assert.equal(result.activeBudget, null) // stage activo sin budget → null
})

test('budgets inválidos (negativo, whitespace, no numérico) se ignoran como sin cargar', () => {
  const project = { baseBudgetHours: null, activeStageId: 1 }
  const stages = [
    { id: 1, budgetHours: -5 },
    { id: 2, budgetHours: '   ' },
    { id: 3, budgetHours: 'abc' },
    { id: 4, budgetHours: 40 },
  ]
  const result = resolveProjectBudget(project, stages, [])
  assert.equal(result.totalBudget, 40) // solo el 40 cuenta
  assert.equal(result.activeBudget, null) // stage activo (id 1) negativo → sin cargar
})

test('normBudget ignora tipos no numéricos (boolean, array)', () => {
  const project = { baseBudgetHours: null, activeStageId: 1 }
  const stages = [
    { id: 1, budgetHours: true },
    { id: 2, budgetHours: [5] },
    { id: 3, budgetHours: 30 },
  ]
  const result = resolveProjectBudget(project, stages, [])
  assert.equal(result.totalBudget, 30) // ni true→1 ni [5]→5 cuentan
  assert.equal(result.activeBudget, null)
})

test('con stages pero todos sin budget cargado: total null', () => {
  const project = { baseBudgetHours: 500, activeStageId: 1 }
  const stages = [
    { id: 1, budgetHours: null },
    { id: 2, budgetHours: null },
  ]
  const result = resolveProjectBudget(project, stages, [])
  assert.equal(result.totalBudget, null)
  assert.equal(result.activeBudget, null)
})

test('activeStageId string matchea id numérico del stage', () => {
  const project = { baseBudgetHours: null, activeStageId: '2' }
  const stages = [
    { id: 1, budgetHours: 100 },
    { id: 2, budgetHours: 60 },
  ]
  const result = resolveProjectBudget(project, stages, [])
  assert.equal(result.activeBudget, 60)
})
