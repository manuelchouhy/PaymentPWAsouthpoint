import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggregateLoggedTasks } from './projectLoggedTasks.js'

const row = (over = {}) => ({
  task: 'Task A',
  task_number: '2001',
  hours: 5,
  status: 'Approved',
  allocation: 'bill_to_client',
  ...over,
})

test('agrupa por nombre; suma hours (todas) y consumedHours (Approved + alloc consumible)', () => {
  const out = aggregateLoggedTasks([
    row({ task: 'Task A', hours: 5, status: 'Approved', allocation: 'bill_to_client' }),
    row({ task: 'Task A', hours: 3, status: 'Approved', allocation: 'sp_internal' }),
    row({ task: 'Task A', hours: 2, status: 'Pending', allocation: 'bill_to_client' }),
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].taskName, 'Task A')
  assert.equal(out[0].hours, 10) // 5 + 3 + 2 (todas)
  assert.equal(out[0].consumedHours, 8) // 5 + 3 (Approved bill_to_client/sp_internal); la Pending no
})

test('overage y rejected NO cuentan como consumido, pero sí como logged', () => {
  const out = aggregateLoggedTasks([
    row({ task: 'T', hours: 10, status: 'Approved', allocation: 'bill_to_client' }),
    row({ task: 'T', hours: 7, status: 'Approved', allocation: 'overage' }), // no consumido
    row({ task: 'T', hours: 4, status: 'Rejected', allocation: 'bill_to_client' }), // no consumido
  ])
  assert.equal(out[0].hours, 21) // 10 + 7 + 4
  assert.equal(out[0].consumedHours, 10) // sólo la Approved bill_to_client
})

test('taskNumber: el primero no vacío gana; tolera null', () => {
  const out = aggregateLoggedTasks([
    row({ task: 'T', task_number: null }),
    row({ task: 'T', task_number: '9999' }),
  ])
  assert.equal(out[0].taskNumber, '9999')
  const noNum = aggregateLoggedTasks([row({ task: 'T', task_number: null })])
  assert.equal(noNum[0].taskNumber, null)
})

test('lee taskNumber (camelCase, data demo) además de task_number', () => {
  const out = aggregateLoggedTasks([{ task: 'T', taskNumber: 42, hours: 1, status: 'Approved', allocation: 'bill_to_client' }])
  assert.equal(out[0].taskNumber, '42')
})

test('descarta entries sin nombre de task', () => {
  const out = aggregateLoggedTasks([row({ task: '' }), row({ task: null }), row({ task: 'Real' })])
  assert.equal(out.length, 1)
  assert.equal(out[0].taskName, 'Real')
})

test('ordena por nombre con orden natural (Task 2 antes de Task 10)', () => {
  const out = aggregateLoggedTasks([row({ task: 'Task 10' }), row({ task: 'Task 2' })])
  assert.deepEqual(out.map((t) => t.taskName), ['Task 2', 'Task 10'])
})

test('lista vacía / undefined → []', () => {
  assert.deepEqual(aggregateLoggedTasks([]), [])
  assert.deepEqual(aggregateLoggedTasks(), [])
})
