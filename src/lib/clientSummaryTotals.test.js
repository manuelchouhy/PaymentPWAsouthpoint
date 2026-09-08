import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chartTotals, portfolioTotals, tableTotalsByClient } from './clientSummaryTotals.js'

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
