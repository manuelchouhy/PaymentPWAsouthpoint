import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildProjectTaskTree } from './projectTaskTree.js'

const stage = (id, stageName, position = 0, sowNumber = '') => ({ id, stageName, position, sowNumber })
const task = (id, taskName, stageId = null, extra = {}) => ({ id, taskName, stageId, ...extra })

test('agrupa los tasks bajo su stage (por stageId) en orden de position', () => {
  const stages = [stage('s2', 'Stage 2', 1), stage('s1', 'Stage 1', 0)]
  const tasks = [task('t1', 'A', 's1'), task('t2', 'B', 's2'), task('t3', 'C', 's1')]
  const tree = buildProjectTaskTree(stages, tasks)
  // Stages ordenados por position; cada uno con sus tasks.
  assert.deepEqual(
    tree.map((n) => [n.label, n.tasks.map((t) => t.taskName)]),
    [
      ['Stage 1', ['A', 'C']],
      ['Stage 2', ['B']],
    ],
  )
})

test('un stage sin tasks igual aparece con tasks: []', () => {
  const tree = buildProjectTaskTree([stage('s1', 'Stage 1')], [])
  assert.equal(tree.length, 1)
  assert.equal(tree[0].label, 'Stage 1')
  assert.deepEqual(tree[0].tasks, [])
})

test('tasks sin stage (o con stageId inexistente) caen en "No stage" al final', () => {
  const stages = [stage('s1', 'Stage 1', 0)]
  const tasks = [task('t1', 'A', 's1'), task('t2', 'B', null), task('t3', 'C', 'nope')]
  const tree = buildProjectTaskTree(stages, tasks)
  assert.deepEqual(
    tree.map((n) => [n.label, n.tasks.map((t) => t.taskName)]),
    [
      ['Stage 1', ['A']],
      ['No stage', ['B', 'C']],
    ],
  )
})

test('sin stages: todos los tasks caen en "No stage" (realidad actual del schema)', () => {
  const tree = buildProjectTaskTree([], [task('t1', 'A'), task('t2', 'B')])
  assert.equal(tree.length, 1)
  assert.equal(tree[0].label, 'No stage')
  assert.deepEqual(tree[0].tasks.map((t) => t.taskName), ['A', 'B'])
})

test('sin stages ni tasks → [] (incluye args undefined/null)', () => {
  assert.deepEqual(buildProjectTaskTree([], []), [])
  assert.deepEqual(buildProjectTaskTree(), [])
  assert.deepEqual(buildProjectTaskTree(null, null), [])
  assert.deepEqual(buildProjectTaskTree(null, [task('t1', 'A')])[0].label, 'No stage')
})

test('fallback por membresía: task logueado sin stageId cae bajo su stage por taskNumber', () => {
  const stages = [stage('s1', 'Stage 1', 0), stage('s2', 'Stage 2', 1)]
  const tasks = [
    task('t1', 'A', null, { taskNumber: 'Z-100' }), // sin stage SOW, pero Z-100 → s2 por membresía
    task('t2', 'B', 's1'), // stage del SOW tiene prioridad
    task('t3', 'C', null, { taskNumber: 'Z-999' }), // no está en membresía → No stage
  ]
  const taskToStage = { 'Z-100': 's2' }
  const tree = buildProjectTaskTree(stages, tasks, taskToStage)
  const byLabel = Object.fromEntries(tree.map((n) => [n.label, n.tasks.map((t) => t.taskName)]))
  assert.deepEqual(byLabel['Stage 1'], ['B'])
  assert.deepEqual(byLabel['Stage 2'], ['A'])
  assert.deepEqual(byLabel['No stage'], ['C'])
})

test('fallback por membresía: el stageId del SOW gana sobre la membresía', () => {
  const stages = [stage('s1', 'Stage 1', 0), stage('s2', 'Stage 2', 1)]
  const tasks = [task('t1', 'A', 's1', { taskNumber: 'Z-1' })]
  const tree = buildProjectTaskTree(stages, tasks, { 'Z-1': 's2' })
  const s1 = tree.find((n) => n.label === 'Stage 1')
  assert.deepEqual(s1.tasks.map((t) => t.taskName), ['A'])
})

test('fallback por membresía: un stage que no es del proyecto se ignora → No stage', () => {
  const stages = [stage('s1', 'Stage 1', 0)]
  const tasks = [task('t1', 'A', null, { taskNumber: 'Z-1' })]
  const tree = buildProjectTaskTree(stages, tasks, { 'Z-1': 'sX' }) // sX no está en stages
  assert.equal(tree.find((n) => n.label === 'No stage').tasks[0].taskName, 'A')
})
