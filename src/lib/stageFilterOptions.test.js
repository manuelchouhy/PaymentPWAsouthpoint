import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStageOptions } from './stageFilterOptions.js'

// catálogo: stageId → { name, projectId, projectNumber }
const cat = (entries) => new Map(entries.map(([id, name, projectId, projectNumber]) =>
  [id, { name, projectId, projectNumber }]))

test('opciones = presentes ∪ seleccionados, ordenadas por nombre', () => {
  const catalog = cat([
    ['S1', 'Alpha', 'p1', 'PP1'],
    ['S2', 'Beta', 'p1', 'PP1'],
  ])
  const { optionIds } = buildStageOptions({ presentStageIds: ['S2', 'S1'], selectedIds: [], catalog })
  assert.deepEqual(optionIds, ['S1', 'S2'])
})

test('un seleccionado fuera de scope igual aparece en las opciones', () => {
  const catalog = cat([
    ['S1', 'Alpha', 'p1', 'PP1'],
    ['S2', 'Beta', 'p1', 'PP1'],
  ])
  // S2 no está presente (no pasa los otros filtros), pero está seleccionado.
  const { optionIds } = buildStageOptions({ presentStageIds: ['S1'], selectedIds: ['S2'], catalog })
  assert.deepEqual(optionIds, ['S1', 'S2'])
})

test('rótulo con prefijo Project# cuando las opciones abarcan >1 proyecto', () => {
  const catalog = cat([
    ['S1', 'Stage 1', 'p1', 'PP1'],
    ['S2', 'Stage 1', 'p2', 'PP2'],
  ])
  const { getLabel } = buildStageOptions({ presentStageIds: ['S1', 'S2'], selectedIds: [], catalog })
  assert.equal(getLabel('S1'), 'PP1 · Stage 1')
  assert.equal(getLabel('S2'), 'PP2 · Stage 1')
})

test('en multi-proyecto el orden agrupa por proyecto, no por nombre pelado', () => {
  const catalog = cat([
    ['S1', 'Beta', 'p1', 'PP1'],
    ['S2', 'Alpha', 'p2', 'PP2'],
  ])
  // Por nombre pelado sería [S2 'Alpha', S1 'Beta']; agrupado por proyecto es [PP1·Beta, PP2·Alpha].
  const { optionIds } = buildStageOptions({ presentStageIds: ['S1', 'S2'], selectedIds: [], catalog })
  assert.deepEqual(optionIds, ['S1', 'S2'])
})

test('rótulo sin prefijo cuando todas las opciones caen en un solo proyecto', () => {
  const catalog = cat([
    ['S1', 'Stage 1', 'p1', 'PP1'],
    ['S2', 'Stage 2', 'p1', 'PP1'],
  ])
  const { getLabel } = buildStageOptions({ presentStageIds: ['S1', 'S2'], selectedIds: [], catalog })
  assert.equal(getLabel('S1'), 'Stage 1')
  assert.equal(getLabel('S2'), 'Stage 2')
})

test('fallback de nombre cuando el catálogo no lo trae', () => {
  const catalog = new Map() // sin entradas
  const { getLabel } = buildStageOptions({ presentStageIds: [], selectedIds: ['S9'], catalog })
  assert.equal(getLabel('S9'), 'Stage S9')
})
