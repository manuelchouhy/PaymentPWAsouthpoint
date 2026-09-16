import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterEntriesByStage } from './stageFilter.js'

const E = (id, taskNumber) => ({ id, taskNumber })

test('sin stages elegidos devuelve todas las horas (no filtra)', () => {
  const entries = [E(1, 'T-1'), E(2, 'T-2')]
  const taskToStage = { 'T-1': 'S1', 'T-2': 'S2' }
  assert.deepEqual(filterEntriesByStage(entries, taskToStage, []), entries)
})

test('un stage elegido deja sólo las horas de sus tasks', () => {
  const entries = [E(1, 'T-1'), E(2, 'T-2'), E(3, 'T-1')]
  const taskToStage = { 'T-1': 'S1', 'T-2': 'S2' }
  const out = filterEntriesByStage(entries, taskToStage, ['S1'])
  assert.deepEqual(out.map((e) => e.id), [1, 3])
})

test('horas sin task o con task fuera del mapa no matchean', () => {
  const entries = [E(1, 'T-1'), E(2, 'T-999'), E(3, null)]
  const taskToStage = { 'T-1': 'S1' }
  const out = filterEntriesByStage(entries, taskToStage, ['S1'])
  assert.deepEqual(out.map((e) => e.id), [1])
})

test('multi-stage une las horas de todos los stages elegidos', () => {
  const entries = [E(1, 'T-1'), E(2, 'T-2'), E(3, 'T-3')]
  const taskToStage = { 'T-1': 'S1', 'T-2': 'S2', 'T-3': 'S3' }
  const out = filterEntriesByStage(entries, taskToStage, ['S1', 'S3'])
  assert.deepEqual(out.map((e) => e.id), [1, 3])
})

test('sin stages elegidos, un entries no-array devuelve [] (contrato: siempre array)', () => {
  assert.deepEqual(filterEntriesByStage(null, {}, []), [])
})

test('taskNumber numérico y selectedIds string se matchean igual', () => {
  const entries = [{ id: 1, taskNumber: 1003 }, { id: 2, taskNumber: 1004 }]
  const taskToStage = { '1003': 7 } // stageId numérico en el mapa
  const out = filterEntriesByStage(entries, taskToStage, ['7'])
  assert.deepEqual(out.map((e) => e.id), [1])
})
