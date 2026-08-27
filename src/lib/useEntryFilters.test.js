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
  tasks: [],
  billingStatuses: [],
  allocations: [],
  dateFrom: '',
  dateTo: '',
  week: '',
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
