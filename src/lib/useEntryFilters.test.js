import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyEntryFilters, UNALLOCATED, ALLOCATED } from './useEntryFilters.js'

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
