import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTaskKeyMap } from './parseTaskKeyMap.js'
// Copia ESPEJO que corre en la edge function (Deno no importa de src/). Se importa acá solo
// para el guard anti-drift de abajo.
import { parseTaskKeyMap as parseTaskKeyMapEdge } from '../../supabase/functions/sync-task-keys/parseTaskKeyMap.js'

test('mapea id→key para tasks normalizadas con key', () => {
  const tasks = [
    { id: 'z-t1', key: 'PP1-T1', name: 'Task 1' },
    { id: 'z-t5', key: 'PP1-T5', name: 'Stage II' },
  ]
  assert.deepEqual(parseTaskKeyMap(tasks), {
    'z-t1': 'PP1-T1',
    'z-t5': 'PP1-T5',
  })
})

test('una task sin key se omite del mapa (caerá a "—" en el front)', () => {
  const tasks = [
    { id: 'z-t1', key: 'PP1-T1', name: 'Task 1' },
    { id: 'z-t2', key: null, name: 'Task 2' },
    { id: 'z-t3', name: 'Task 3' }, // key ausente
    { id: 'z-t4', key: '', name: 'Task 4' }, // key vacía
  ]
  assert.deepEqual(parseTaskKeyMap(tasks), { 'z-t1': 'PP1-T1' })
})

test('un id duplicado (overlap de paginación) no se pisa: primero gana', () => {
  const tasks = [
    { id: 'z-t1', key: 'PP1-T1', name: 'Task 1' },
    { id: 'z-t1', key: 'OTRO-KEY', name: 'Task 1 repetida' },
  ]
  assert.deepEqual(parseTaskKeyMap(tasks), { 'z-t1': 'PP1-T1' })
})

test('un hueco null/undefined en el array se saltea sin tirar', () => {
  const tasks = [
    { id: 'z-t1', key: 'PP1-T1', name: 'Task 1' },
    null,
    undefined,
    { id: 'z-t2', key: 'PP1-T2', name: 'Task 2' },
  ]
  assert.deepEqual(parseTaskKeyMap(tasks), { 'z-t1': 'PP1-T1', 'z-t2': 'PP1-T2' })
})

test('un input no-array o vacío devuelve {} sin tirar', () => {
  assert.deepEqual(parseTaskKeyMap([]), {})
  assert.deepEqual(parseTaskKeyMap(null), {})
  assert.deepEqual(parseTaskKeyMap(undefined), {})
  assert.deepEqual(parseTaskKeyMap({ tasks: [] }), {})
})

test('el id numérico (rango seguro) se coerciona a clave string (columna task_number es TEXT)', () => {
  // Número en rango seguro: la coerción number→string es exacta. En producción el id llega
  // como id_string (STRING, ver fetchTopLevelTasks), así que los ids largos se preservan por
  // ser string (ver el test siguiente) — NO se depende de coercionar un número de 19 dígitos.
  const tasks = [{ id: 4242, key: 'PP1-T5', name: 'Stage II' }]
  assert.deepEqual(parseTaskKeyMap(tasks), { '4242': 'PP1-T5' })
})

test('un id largo (~19 díg) pasado como string se preserva exacto (sin pérdida de precisión)', () => {
  const tasks = [{ id: '2236753000000529051', key: 'PP1-T5', name: 'Stage II' }]
  const map = parseTaskKeyMap(tasks)
  assert.ok('2236753000000529051' in map)
  assert.equal(map['2236753000000529051'], 'PP1-T5')
})

test('una task sin id se omite (no hay a qué anclar el key)', () => {
  const tasks = [
    { id: 'z-t1', key: 'PP1-T1', name: 'Task 1' },
    { id: null, key: 'PP1-T9', name: 'huérfana' },
    { id: '', key: 'PP1-T8', name: 'id vacío' },
    { key: 'PP1-T7', name: 'id ausente' },
  ]
  assert.deepEqual(parseTaskKeyMap(tasks), { 'z-t1': 'PP1-T1' })
})

test('la copia espejo del edge function se comporta igual que la de src/ (guard anti-drift)', () => {
  const cases = [
    [{ id: 'z-t1', key: 'PP1-T1' }, { id: 'z-t5', key: 'PP1-T5' }],
    [{ id: 'z-t1', key: 'PP1-T1' }, { id: 'z-t2', key: null }, { id: 'z-t3' }, { id: 'z-t4', key: '' }],
    [{ id: null, key: 'X' }, { id: '', key: 'Y' }, { key: 'Z' }],
    [{ id: 4242, key: 'PP1-T5' }],
    [{ id: '2236753000000529051', key: 'PP1-T5' }],
    [{ id: 'z-t1', key: 'PP1-T1' }, null, undefined, { id: 'z-t2', key: 'PP1-T2' }],
    [{ id: 'z-t1', key: 'PP1-T1' }, { id: 'z-t1', key: 'OTRO' }],
    [],
    null,
    undefined,
    { tasks: [] },
  ]
  for (const c of cases) {
    assert.deepEqual(parseTaskKeyMapEdge(c), parseTaskKeyMap(c))
  }
})
