import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  chartTotals,
  portfolioTotals,
  projectRowTotals,
  tableTotalsByClient,
} from './clientSummaryTotals.js'

const wk = (consumed, overage = 0, pending = 0) => ({ consumed, overage, pending, cumulative: consumed, remaining: 0 })

function sample() {
  return [
    {
      client: 'HSS',
      projects: [
        { id: 1, budget: 120, consumed: 30, overage: 2, weeks: [wk(20), wk(10, 2)] },
        { id: 2, budget: null, consumed: 5, overage: 0, weeks: [wk(5)] },
      ],
    },
  ]
}

test('tableTotalsByClient suma sobre semanas visibles', () => {
  const map = tableTotalsByClient(sample())
  const hss = map.get('HSS')
  assert.equal(hss.consumed, 35) // 20+10 + 5
  assert.equal(hss.overage, 2)
  assert.equal(hss.budget, 120) // solo el proyecto con budget
  assert.equal(hss.hasBudget, true)
})

test('tableTotalsByClient suma las horas pending', () => {
  const clients = [
    { client: 'HSS', projects: [{ id: 1, budget: 120, consumed: 30, overage: 0, weeks: [wk(20, 0, 3), wk(10, 0, 4)] }] },
  ]
  assert.equal(tableTotalsByClient(clients).get('HSS').pending, 7)
})

test('tableTotalsByClient respeta el recorte de semanas (menos filas → menos consumed)', () => {
  const clients = sample()
  clients[0].projects[0].weeks = [wk(10, 2)] // solo una semana visible
  const map = tableTotalsByClient(clients)
  assert.equal(map.get('HSS').consumed, 15) // 10 + 5
})

test('portfolioTotals suma el mapa por-cliente', () => {
  const totals = portfolioTotals(tableTotalsByClient(sample()))
  assert.equal(totals.consumed, 35)
  assert.equal(totals.budget, 120)
  assert.equal(totals.hasBudget, true)
})

test('chartTotals usa horas all-time del proyecto y remaining por-proyecto', () => {
  const t = chartTotals(sample())
  assert.equal(t.consumed, 35) // 30 + 5 (all-time de cada proyecto)
  assert.equal(t.overage, 2)
  assert.equal(t.budget, 120)
  assert.equal(t.remaining, 90) // max(0, 120-30); el proyecto sin budget no aporta
})

test('chartTotals suma pending all-time por proyecto', () => {
  const clients = [
    { client: 'HSS', projects: [
      { id: 1, budget: 120, consumed: 30, overage: 0, pending: 12, weeks: [] },
      { id: 2, budget: null, consumed: 0, overage: 0, pending: 5, weeks: [] },
    ] },
  ]
  assert.equal(chartTotals(clients).pending, 17)
})

test('chartTotals no netea el sobreconsumo de un proyecto contra otro', () => {
  const clients = [
    {
      client: 'X',
      projects: [
        { id: 1, budget: 100, consumed: 40, overage: 0, weeks: [] },
        { id: 2, budget: 50, consumed: 80, overage: 30, weeks: [] }, // sobre budget
      ],
    },
  ]
  const t = chartTotals(clients)
  // remaining = max(0,100-40) + max(0,50-80) = 60 + 0 = 60 (no 100-40+50-80=30)
  assert.equal(t.remaining, 60)
})

test('sin budget cargado, hasBudget=false y remaining 0', () => {
  const t = chartTotals([{ client: 'X', projects: [{ id: 1, budget: null, consumed: 10, overage: 0, weeks: [] }] }])
  assert.equal(t.hasBudget, false)
  assert.equal(t.remaining, 0)
})

test('projectRowTotals suma consumed/pending/overage y toma cumulative/remaining finales', () => {
  const project = {
    id: 1,
    budget: 120,
    weeks: [
      { consumed: 20, overage: 0, pending: 3, cumulative: 20, remaining: 100 },
      { consumed: 10, overage: 2, pending: 4, cumulative: 30, remaining: 90 },
      { consumed: 24, overage: 3, pending: 0, cumulative: 54, remaining: 66 },
    ],
  }
  const t = projectRowTotals(project)
  assert.equal(t.budget, 120)
  assert.equal(t.hasBudget, true)
  assert.equal(t.consumed, 54) // 20+10+24 (suma)
  assert.equal(t.pending, 7) // 3+4+0 (suma)
  assert.equal(t.overage, 5) // 0+2+3 (suma)
  assert.equal(t.cumulative, 54) // final, NO suma
  assert.equal(t.remaining, 66) // final, NO suma
})

test('projectRowTotals sin semanas: remaining cae al budget y acumulados en 0', () => {
  const t = projectRowTotals({ id: 2, budget: 80, weeks: [] })
  assert.equal(t.consumed, 0)
  assert.equal(t.pending, 0)
  assert.equal(t.overage, 0)
  assert.equal(t.cumulative, 0)
  assert.equal(t.remaining, 80) // sin semanas queda intacto el budget
})

test('projectRowTotals trata campos de semana faltantes como 0 (sin NaN)', () => {
  const project = {
    id: 9,
    budget: 50,
    weeks: [
      { cumulative: 10, remaining: 40 }, // sin consumed/pending/overage
      { consumed: 5, cumulative: 15, remaining: 35 }, // sin pending/overage
    ],
  }
  const t = projectRowTotals(project)
  assert.equal(t.consumed, 5)
  assert.equal(t.pending, 0)
  assert.equal(t.overage, 0)
  assert.equal(Number.isNaN(t.consumed), false)
})

test('projectRowTotals sin budget: hasBudget=false y remaining null si no hay semanas', () => {
  const t = projectRowTotals({ id: 3, budget: null, weeks: [] })
  assert.equal(t.hasBudget, false)
  assert.equal(t.budget, null)
  assert.equal(t.remaining, null)
})
