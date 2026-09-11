import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeProjectTasks } from './mergeProjectTasks.js'

test('un task registrado toma consumido/id-de-Zoho del logueado con el mismo nombre', () => {
  const registered = [{ id: 7, taskName: 'Backend', stageId: 3, estimatedHours: 40 }]
  const logged = [{ taskName: 'Backend', taskNumber: '2236', hours: 30, consumedHours: 25 }]
  const out = mergeProjectTasks(registered, logged)
  assert.equal(out.length, 1)
  assert.deepEqual(out[0], {
    taskId: 7,
    taskName: 'Backend',
    taskNumber: '2236',
    stageId: 3,
    estimatedHours: 40,
    hours: 30,
    consumedHours: 25,
    registered: true,
  })
})

test('un task logueado SIN registrar aparece con stageId null (sin asignar) y registered=false', () => {
  const out = mergeProjectTasks([], [{ taskName: 'Ad-hoc', taskNumber: '9', hours: 5, consumedHours: 5 }])
  assert.equal(out.length, 1)
  assert.equal(out[0].taskName, 'Ad-hoc')
  assert.equal(out[0].stageId, null)
  assert.equal(out[0].registered, false)
  assert.equal(out[0].taskId, null)
  assert.equal(out[0].consumedHours, 5)
})

test('un task registrado SIN horas logueadas queda en 0 consumido pero con su estimado y stage', () => {
  const out = mergeProjectTasks([{ id: 1, taskName: 'Plan', stageId: 2, estimatedHours: 10 }], [])
  assert.equal(out[0].consumedHours, 0)
  assert.equal(out[0].hours, 0)
  assert.equal(out[0].estimatedHours, 10)
  assert.equal(out[0].stageId, 2)
  assert.equal(out[0].registered, true)
})

test('descarta entries sin nombre; ordena natural', () => {
  const out = mergeProjectTasks(
    [{ id: 1, taskName: '', stageId: null }],
    [{ taskName: 'Task 10' }, { taskName: 'Task 2' }, { taskName: null }],
  )
  assert.deepEqual(out.map((t) => t.taskName), ['Task 2', 'Task 10'])
})

test('vacío / undefined → []', () => {
  assert.deepEqual(mergeProjectTasks([], []), [])
  assert.deepEqual(mergeProjectTasks(), [])
})
