import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildClientSummaryWeekly } from './clientSummaryWeekly.js'

// Helper: proyecto mínimo.
const project = (over = {}) => ({
  id: 1,
  projectName: 'Forecasting',
  projectNumber: 'SP-25',
  sowNumber: 'SOW-213',
  customerName: 'HSS',
  baseBudgetHours: 120,
  zohoStatus: 'active',
  ...over,
})

// Helper: entry mínima.
const entry = (over = {}) => ({
  date: '2026-08-05', // miércoles
  project: 'Forecasting',
  hours: 10,
  status: 'Approved',
  allocation: 'bill_to_client',
  ...over,
})

test('agrupa cliente → proyecto → semana con consumed y budget', () => {
  const result = buildClientSummaryWeekly({
    projects: [project()],
    entries: [entry({ hours: 23 })],
    crsByProject: new Map(),
  })

  assert.equal(result.clients.length, 1)
  const client = result.clients[0]
  assert.equal(client.client, 'HSS')
  assert.equal(client.projects.length, 1)

  const proj = client.projects[0]
  assert.equal(proj.projectNumber, 'SP-25')
  assert.equal(proj.budget, 120)
  assert.equal(proj.weeks.length, 1)
  assert.equal(proj.weeks[0].consumed, 23)
  assert.equal(proj.weeks[0].overage, 0)
})

test('cumulative y remaining se calculan cronológicamente entre semanas', () => {
  const { clients } = buildClientSummaryWeekly({
    projects: [project({ baseBudgetHours: 120 })],
    entries: [
      entry({ date: '2026-08-12', hours: 10 }), // semana posterior, cargada primero
      entry({ date: '2026-08-05', hours: 23 }), // semana anterior
    ],
    crsByProject: new Map(),
  })
  const weeks = clients[0].projects[0].weeks
  assert.equal(weeks.length, 2)
  // Ordenadas por weekStart ascendente sin importar el orden de carga.
  assert.ok(weeks[0].weekStart < weeks[1].weekStart)
  assert.deepEqual(
    weeks.map((w) => [w.consumed, w.cumulative, w.remaining]),
    [
      [23, 23, 97],
      [10, 33, 87],
    ],
  )
})

test('solo cuenta entries Approved (ignora Rejected/Pending y sp_internal/unallocated)', () => {
  const { clients } = buildClientSummaryWeekly({
    projects: [project()],
    entries: [
      entry({ hours: 23, status: 'Approved', allocation: 'bill_to_client' }),
      entry({ hours: 99, status: 'Rejected', allocation: 'bill_to_client' }),
      entry({ hours: 99, status: 'Pending', allocation: 'bill_to_client' }),
      entry({ hours: 99, status: 'Approved', allocation: 'sp_internal' }),
      entry({ hours: 99, status: 'Approved', allocation: null }),
    ],
    crsByProject: new Map(),
  })
  assert.equal(clients[0].projects[0].consumed, 23)
})

test('separa overage de consumed en la misma semana', () => {
  const { clients } = buildClientSummaryWeekly({
    projects: [project()],
    entries: [
      entry({ hours: 10, allocation: 'bill_to_client' }),
      entry({ hours: 3, allocation: 'overage' }),
    ],
    crsByProject: new Map(),
  })
  const week = clients[0].projects[0].weeks[0]
  assert.equal(week.consumed, 10)
  assert.equal(week.overage, 3)
})

test('budget = base + change requests expand_budget aprobados (ignora otros)', () => {
  const { clients } = buildClientSummaryWeekly({
    projects: [project({ id: 1, baseBudgetHours: 120 })],
    entries: [],
    crsByProject: new Map([
      [
        '1',
        [
          { status: 'approved', type: 'expand_budget', deltaHours: 40 },
          { status: 'approved', type: 'write_off_overage', deltaHours: 10 },
          { status: 'pending', type: 'expand_budget', deltaHours: 100 },
        ],
      ],
    ]),
  })
  assert.equal(clients[0].projects[0].budget, 160)
})

test('budget null cuando el proyecto no tiene presupuesto base', () => {
  const { clients } = buildClientSummaryWeekly({
    projects: [project({ baseBudgetHours: null })],
    entries: [],
    crsByProject: new Map(),
  })
  assert.equal(clients[0].projects[0].budget, null)
})

test('multi-stage: SOW coma-separado y horas sumadas a nivel proyecto', () => {
  const { clients } = buildClientSummaryWeekly({
    projects: [project({ stageSowNumbers: ['SOW-1', 'SOW-2'] })],
    entries: [entry({ hours: 5 }), entry({ hours: 7 })],
    crsByProject: new Map(),
  })
  const proj = clients[0].projects[0]
  assert.equal(proj.sowNumber, 'SOW-1, SOW-2')
  assert.equal(proj.consumed, 12)
})

test('la misma semana de años distintos no se fusiona (year-aware)', () => {
  const { clients } = buildClientSummaryWeekly({
    projects: [project()],
    entries: [
      entry({ date: '2025-08-06', hours: 4 }),
      entry({ date: '2026-08-05', hours: 6 }),
    ],
    crsByProject: new Map(),
  })
  const weeks = clients[0].projects[0].weeks
  assert.equal(weeks.length, 2)
  assert.deepEqual(
    weeks.map((w) => w.year),
    [2025, 2026],
  )
})

test('totales de portfolio: suma filas; budget null no cuenta como 0', () => {
  const { totals } = buildClientSummaryWeekly({
    projects: [
      project({ id: 1, projectName: 'A', customerName: 'HSS', baseBudgetHours: 120 }),
      project({ id: 2, projectName: 'B', customerName: 'HSS', baseBudgetHours: null }),
    ],
    entries: [
      entry({ project: 'A', hours: 23, allocation: 'bill_to_client' }),
      entry({ project: 'B', hours: 5, allocation: 'bill_to_client' }),
      entry({ project: 'A', hours: 2, allocation: 'overage' }),
    ],
    crsByProject: new Map(),
  })
  assert.equal(totals.budget, 120)
  assert.equal(totals.consumed, 28)
  assert.equal(totals.overage, 2)
})

test('agrupa por customerName, cae a client y luego a "Without client"', () => {
  const { clients } = buildClientSummaryWeekly({
    projects: [
      project({ id: 1, projectName: 'A', customerName: 'HSS', client: 'x' }),
      project({ id: 2, projectName: 'B', customerName: null, client: 'Acme' }),
      project({ id: 3, projectName: 'C', customerName: null, client: null }),
    ],
    entries: [],
    crsByProject: new Map(),
  })
  // Ordenados alfabéticamente: Acme, HSS, Without client.
  assert.deepEqual(
    clients.map((c) => c.client),
    ['Acme', 'HSS', 'Without client'],
  )
})

test('dos proyectos con el mismo projectName no se contaminan cumulative/remaining', () => {
  const { clients } = buildClientSummaryWeekly({
    projects: [
      project({ id: 1, projectName: 'Dup', customerName: 'HSS', baseBudgetHours: 120 }),
      project({ id: 2, projectName: 'Dup', customerName: 'HSS', baseBudgetHours: 200 }),
    ],
    entries: [entry({ project: 'Dup', hours: 30 })],
    crsByProject: new Map(),
  })
  const projs = clients[0].projects
  assert.equal(projs.length, 2)
  const byId = new Map(projs.map((p) => [p.id, p]))
  // Cada proyecto tiene su propio remaining contra SU budget, sin pisarse.
  assert.equal(byId.get(1).weeks[0].remaining, 90) // 120 - 30
  assert.equal(byId.get(2).weeks[0].remaining, 170) // 200 - 30
})

test('descarta entries sin nombre de proyecto (no las atribuye a nadie)', () => {
  const { clients, totals } = buildClientSummaryWeekly({
    projects: [project({ projectName: '' })],
    entries: [entry({ project: '', hours: 50 }), entry({ project: null, hours: 7 })],
    crsByProject: new Map(),
  })
  // El proyecto de nombre vacío NO se apropia de las horas huérfanas.
  assert.equal(clients[0].projects[0].weeks.length, 0)
  assert.equal(totals.consumed, 0)
})

test('un proyecto sin entries aparece igual, con weeks vacías y consumed 0', () => {
  const { clients } = buildClientSummaryWeekly({
    projects: [project({ baseBudgetHours: 120 })],
    entries: [],
    crsByProject: new Map(),
  })
  const proj = clients[0].projects[0]
  assert.equal(proj.weeks.length, 0)
  assert.equal(proj.consumed, 0)
  assert.equal(proj.overage, 0)
  assert.equal(proj.budget, 120)
})
