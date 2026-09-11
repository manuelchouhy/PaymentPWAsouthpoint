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

test('tasks sin stage (o con stageId inexistente) caen en "Sin stage" al final', () => {
  const stages = [stage('s1', 'Stage 1', 0)]
  const tasks = [task('t1', 'A', 's1'), task('t2', 'B', null), task('t3', 'C', 'nope')]
  const tree = buildProjectTaskTree(stages, tasks)
  assert.deepEqual(
    tree.map((n) => [n.label, n.tasks.map((t) => t.taskName)]),
    [
      ['Stage 1', ['A']],
      ['Sin stage', ['B', 'C']],
    ],
  )
})

test('sin stages: todos los tasks caen en "Sin stage" (realidad actual del schema)', () => {
  const tree = buildProjectTaskTree([], [task('t1', 'A'), task('t2', 'B')])
  assert.equal(tree.length, 1)
  assert.equal(tree[0].label, 'Sin stage')
  assert.deepEqual(tree[0].tasks.map((t) => t.taskName), ['A', 'B'])
})

test('sin stages ni tasks → []', () => {
  assert.deepEqual(buildProjectTaskTree([], []), [])
  assert.deepEqual(buildProjectTaskTree(), [])
})
