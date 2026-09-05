import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyEntryFilters,
  buildFilterOptions,
  UNALLOCATED,
  ALLOCATED,
  OTHER_CLIENT,
} from './useEntryFilters.js'

// Filtros vacíos (misma forma que EMPTY_FILTERS) con sólo `allocations` variando.
const base = {
  contractors: [],
  clients: [],
  projects: [],
  projectNumbers: [],
  tasks: [],
  billingStatuses: [],
  statuses: [],
  allocations: [],
  dateFrom: '',
  dateTo: '',
  week: '',
  weekStart: '',
}
const entries = [
  { id: 1, allocation: null }, // sin clasificar
  { id: 2, allocation: 'bill_to_client' },
  { id: 3, allocation: 'overage' },
  { id: 4, allocation: 'unknown' }, // X (también es "aplicada")
  { id: 5, allocation: '' }, // vacía → cuenta como sin clasificar, no como aplicada
]
const ids = (rows) => rows.map((e) => e.id)

test('sin filtro de allocation → todas', () => {
  assert.deepEqual(ids(applyEntryFilters(entries, base, new Map())), [1, 2, 3, 4, 5])
})

test('ALLOCATED → sólo las que tienen allocation puesta (incluye X, excluye la vacía)', () => {
  const r = applyEntryFilters(entries, { ...base, allocations: [ALLOCATED] }, new Map())
  assert.deepEqual(ids(r), [2, 3, 4])
})

test('UNALLOCATED → sin clasificar: null y también la cadena vacía', () => {
  const r = applyEntryFilters(entries, { ...base, allocations: [UNALLOCATED] }, new Map())
  assert.deepEqual(ids(r), [1, 5])
})

test('UNALLOCATED + ALLOCATED (OR) → todas', () => {
  const r = applyEntryFilters(entries, { ...base, allocations: [UNALLOCATED, ALLOCATED] }, new Map())
  assert.deepEqual(ids(r), [1, 2, 3, 4, 5])
})

test('selección puntual sigue funcionando y convive con ALLOCATED', () => {
  assert.deepEqual(
    ids(applyEntryFilters(entries, { ...base, allocations: ['overage'] }, new Map())),
    [3],
  )
  // 'overage' es redundante con ALLOCATED (OR), el resultado son todas las aplicadas.
  assert.deepEqual(
    ids(applyEntryFilters(entries, { ...base, allocations: ['overage', ALLOCATED] }, new Map())),
    [2, 3, 4],
  )
})

// --- Filtro por NÚMERO de proyecto (independiente del de nombre) -------------
const projNumEntries = [
  { id: 1, project: 'Alpha', projectNumber: 'PRJ-1' },
  { id: 2, project: 'Alpha', projectNumber: 'PRJ-1' },
  { id: 3, project: 'Beta', projectNumber: 'PRJ-2' },
  { id: 4, project: 'Gamma', projectNumber: null }, // sin número resuelto
]

test('projectNumbers → sólo las horas de ese número', () => {
  const r = applyEntryFilters(projNumEntries, { ...base, projectNumbers: ['PRJ-1'] }, new Map())
  assert.deepEqual(ids(r), [1, 2])
})

test('projectNumbers activo oculta las horas sin número resuelto', () => {
  const r = applyEntryFilters(projNumEntries, { ...base, projectNumbers: ['PRJ-2'] }, new Map())
  assert.deepEqual(ids(r), [3]) // la id 4 (projectNumber null) queda afuera
})

test('projectNumbers y projects (nombre) son filtros independientes que se cruzan (AND)', () => {
  // Número PRJ-1 (ids 1,2) AND nombre Beta (id 3) → intersección vacía.
  const r = applyEntryFilters(
    projNumEntries,
    { ...base, projectNumbers: ['PRJ-1'], projects: ['Beta'] },
    new Map(),
  )
  assert.deepEqual(ids(r), [])
})

test('buildFilterOptions expone projectNumbers (falsy descartado)', () => {
  const opts = buildFilterOptions(projNumEntries, base, new Map())
  assert.deepEqual(opts.projectNumbers, ['PRJ-1', 'PRJ-2'])
})

// --- Filtro de Status de aprobación (Approved / Rejected / Pending) ----------
// El status llega de Zoho (approval_status) y se guarda tal cual en la entry.
// En producción hoy conviven Approved y Pending; Rejected lo contempla el modelo.
const statusEntries = [
  { id: 1, status: 'Approved' },
  { id: 2, status: 'Pending' },
  { id: 3, status: 'Rejected' },
  { id: 4, status: 'Approved' },
]

test('sin filtro de status → todas', () => {
  assert.deepEqual(ids(applyEntryFilters(statusEntries, base, new Map())), [1, 2, 3, 4])
})

test('un status → sólo las de ese status', () => {
  const r = applyEntryFilters(statusEntries, { ...base, statuses: ['Approved'] }, new Map())
  assert.deepEqual(ids(r), [1, 4])
})

test('varios status (OR) → cualquiera de los tildados', () => {
  const r = applyEntryFilters(statusEntries, { ...base, statuses: ['Pending', 'Rejected'] }, new Map())
  assert.deepEqual(ids(r), [2, 3])
})

test('status inesperado (fuera de los tres) → se oculta con filtro activo, se ve sin filtro', () => {
  const weird = [{ id: 9, status: '' }, { id: 10, status: 'Whatever' }]
  // Sin filtro de status: pasan las dos.
  assert.deepEqual(ids(applyEntryFilters(weird, base, new Map())), [9, 10])
  // Con filtro activo: ninguna matchea ninguna opción → se ocultan.
  assert.deepEqual(
    ids(applyEntryFilters(weird, { ...base, statuses: ['Approved', 'Rejected', 'Pending'] }, new Map())),
    [],
  )
})

// --- Filtro de Cliente con maestro (dropdown = maestro + Others) -------------
// Con `masterClients`, el filtro de Cliente matchea por "clave": el nombre del
// maestro tal cual, o el centinela Others para los que no están en él (legacy o
// sin resolver). Sin `masterClients`, matchea por el valor crudo de entry.client.
const clientEntries = [
  { id: 1, client: 'Acme Corp' }, // en el maestro
  { id: 2, client: 'Health Systems' }, // en el maestro
  { id: 3, client: 'Northwind' }, // legacy: NO está en el maestro
  { id: 4, client: '' }, // sin cliente resuelto
]
const master = new Set(['Acme Corp', 'Health Systems'])

test('cliente del maestro → matchea sólo ese cliente', () => {
  const r = applyEntryFilters(clientEntries, { ...base, clients: ['Acme Corp'] }, new Map(), master)
  assert.deepEqual(ids(r), [1])
})

test('Others → los que no están en el maestro (legacy + sin resolver)', () => {
  const r = applyEntryFilters(clientEntries, { ...base, clients: [OTHER_CLIENT] }, new Map(), master)
  assert.deepEqual(ids(r), [3, 4])
})

test('maestro + Others juntos (OR)', () => {
  const r = applyEntryFilters(
    clientEntries,
    { ...base, clients: ['Acme Corp', OTHER_CLIENT] },
    new Map(),
    master,
  )
  assert.deepEqual(ids(r), [1, 3, 4])
})

test('sin masterClients (compat) → matchea por el valor crudo del cliente', () => {
  const r = applyEntryFilters(clientEntries, { ...base, clients: ['Northwind'] }, new Map())
  assert.deepEqual(ids(r), [3])
})

test('buildFilterOptions con maestro: opciones de Cliente = maestro presente + Others', () => {
  const opts = buildFilterOptions(clientEntries, base, new Map(), master)
  assert.deepEqual(opts.clients, ['Acme Corp', 'Health Systems', OTHER_CLIENT])
})

test('buildFilterOptions sin maestro (compat): opciones = valores crudos del cliente', () => {
  const opts = buildFilterOptions(clientEntries, base, new Map())
  assert.deepEqual(opts.clients, ['Acme Corp', 'Health Systems', 'Northwind'])
})

// --- Filtro de semana year-aware (weekStart, navegador de Entries) -----------
// weekStart guarda el domingo (YYYY-MM-DD) que inicia la semana física elegida.
// La semana del 2026-08-23 (dom) va hasta el 2026-08-29 (sáb).
const weekEntries = [
  { id: 1, date: '2026-08-23' }, // domingo: inicio de la semana
  { id: 2, date: '2026-08-29' }, // sábado: misma semana
  { id: 3, date: '2026-08-30' }, // domingo siguiente: otra semana
  { id: 4, date: '2025-08-24' }, // domingo, pero de 2025: mismo esquema, otro año
  { id: 5, date: '' }, // sin fecha válida
]

test('weekStart → sólo la semana física exacta (año incluido)', () => {
  const r = applyEntryFilters(weekEntries, { ...base, weekStart: '2026-08-23' }, new Map())
  assert.deepEqual(ids(r), [1, 2])
})

test('weekStart es year-aware: no arrastra la misma semana de otro año', () => {
  // 2025-08-24 arranca su propia semana; nunca cae bajo weekStart de 2026.
  const r = applyEntryFilters(weekEntries, { ...base, weekStart: '2025-08-24' }, new Map())
  assert.deepEqual(ids(r), [4])
})

test('weekStart vacío → no filtra por semana', () => {
  const r = applyEntryFilters(weekEntries, { ...base, weekStart: '' }, new Map())
  assert.deepEqual(ids(r), [1, 2, 3, 4, 5])
})

test('weekStart activo oculta las entries sin fecha válida', () => {
  const r = applyEntryFilters(weekEntries, { ...base, weekStart: '2026-08-30' }, new Map())
  assert.deepEqual(ids(r), [3]) // la id 5 (sin fecha) queda afuera
})
