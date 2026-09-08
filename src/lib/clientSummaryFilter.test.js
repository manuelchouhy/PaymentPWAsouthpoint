import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterClientSummary } from './clientSummaryFilter.js'
import { weekLabel } from './clientSummaryWeekly.js'

const wk = (n, ws) => ({ weekStart: ws, sundayWeek: n, year: 2026, consumed: 1, overage: 0, cumulative: 1, remaining: 0 })

function sample() {
  return [
    {
      client: 'HSS',
      projects: [
        { id: 1, projectNumber: 'SP-25', projectName: 'Forecasting', sowNumber: 'SOW-213', weeks: [wk(31, '2026-08-02'), wk(32, '2026-08-09')] },
        { id: 2, projectNumber: 'SP-7', projectName: 'ETL', sowNumber: 'SOW-1, SOW-2', weeks: [wk(31, '2026-08-02')] },
      ],
    },
    {
      client: 'Acme',
      projects: [{ id: 3, projectNumber: 'AC-1', projectName: 'Platform', sowNumber: 'SOW-9', weeks: [] }],
    },
  ]
}

const ids = (clients) => clients.flatMap((c) => c.projects.map((p) => p.id))

test('sin filtros devuelve todo', () => {
  const out = filterClientSummary(sample(), {})
  assert.deepEqual(ids(out), [1, 2, 3])
})

test('filtro Client acota a ese cliente', () => {
  const out = filterClientSummary(sample(), { clients: ['HSS'] })
  assert.deepEqual(out.map((c) => c.client), ['HSS'])
  assert.deepEqual(ids(out), [1, 2])
})

test('filtro Project # acota al proyecto y descarta el cliente sin proyectos', () => {
  const out = filterClientSummary(sample(), { projectNumbers: ['SP-25'] })
  assert.deepEqual(ids(out), [1])
})

test('filtro SOW matchea SOW individuales de un proyecto multi-stage', () => {
  const out = filterClientSummary(sample(), { sows: ['SOW-2'] })
  assert.deepEqual(ids(out), [2])
})

test('AND entre categorías: Client HSS + Project ETL', () => {
  const out = filterClientSummary(sample(), { clients: ['HSS'], projectNames: ['ETL'] })
  assert.deepEqual(ids(out), [2])
})

test('filtro Week recorta semanas visibles y descarta proyectos/clientes sin match', () => {
  const out = filterClientSummary(sample(), { weeks: [weekLabel(wk(32, '2026-08-09'))] })
  // Proyecto 1 queda solo con la semana 32; proyecto 2 (sin w32) y Acme (sin
  // semanas) se descartan.
  assert.deepEqual(ids(out), [1])
  assert.equal(out[0].projects[0].weeks.length, 1)
  assert.equal(out[0].projects[0].weeks[0].sundayWeek, 32)
})

test('no muta la entrada (recorte de semanas produce objetos nuevos)', () => {
  const input = sample()
  filterClientSummary(input, { weeks: [weekLabel(wk(31, '2026-08-02'))] })
  assert.equal(input[0].projects[0].weeks.length, 2)
})
