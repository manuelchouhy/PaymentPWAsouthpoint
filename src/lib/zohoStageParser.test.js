import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isStageName, detectStages } from './zohoStageParser.js'

test('un nombre "Stage II" es un Stage', () => {
  assert.equal(isStageName('Stage II'), true)
})

test('una task común "Task 1" no es un Stage', () => {
  assert.equal(isStageName('Task 1'), false)
})

test('la detección es case-insensitive: "stage 1" es un Stage', () => {
  assert.equal(isStageName('stage 1'), true)
})

test('"Staging deploy" NO es un Stage (no es la palabra "Stage")', () => {
  assert.equal(isStageName('Staging deploy'), false)
})

test('"Stage" pelado NO es un Stage (tiene que venir "Stage" + algo)', () => {
  assert.equal(isStageName('Stage'), false)
})

test('se ignora el whitespace de los bordes: "  Stage 2  " es un Stage', () => {
  assert.equal(isStageName('  Stage 2  '), true)
})

test('el separador puede ser número o símbolo: "Stage2" y "Stage-2 QA" son Stages', () => {
  assert.equal(isStageName('Stage2'), true)
  assert.equal(isStageName('Stage-2 QA'), true)
})

test('una letra (incl. no-ASCII) tras "Stage" NO es Stage: "Staged", "Stageño"', () => {
  assert.equal(isStageName('Staged'), false)
  assert.equal(isStageName('Stageño'), false)
})

test('"Stage" + separador suelto (sin label real) NO es Stage: "Stage:", "Stage -"', () => {
  assert.equal(isStageName('Stage:'), false)
  assert.equal(isStageName('Stage -'), false)
})

test('detectStages devuelve solo las Tasks-Stage con { zohoTaskId, name }', () => {
  // Mezcla como "Proyecto Prueba": tasks comunes + una Stage + una subtarea con typo.
  const tasks = [
    { id: 'z-t1', name: 'Task 1' },
    { id: 'z-t2', name: 'Task 2' },
    { id: 'z-t5', name: 'Stage II' },
    { id: 'z-t8', name: 'Task Stapge 2.4' }, // typo real: NO es un Stage
  ]
  assert.deepEqual(detectStages(tasks), [{ zohoTaskId: 'z-t5', name: 'Stage II' }])
})

test('detectStages tolera huecos null/undefined en el array (no tira)', () => {
  const tasks = [null, { id: 'z-t5', name: 'Stage II' }, undefined, { id: 'z-t1', name: 'Task 1' }]
  assert.deepEqual(detectStages(tasks), [{ zohoTaskId: 'z-t5', name: 'Stage II' }])
})

test('detectStages con un argumento no-array (null) devuelve [] sin tirar', () => {
  assert.deepEqual(detectStages(null), [])
})

test('detectStages descarta una Task-Stage sin id de Zoho (inusable para el upsert)', () => {
  const tasks = [{ name: 'Stage II' }, { id: 'z-t5', name: 'Stage III' }]
  assert.deepEqual(detectStages(tasks), [{ zohoTaskId: 'z-t5', name: 'Stage III' }])
})

test('detectStages descarta id vacío ("") y coerciona el id numérico a string', () => {
  // Nota: los ids reales de Zoho son enteros grandes (fuera del rango seguro de JS),
  // por eso el edge function normaliza desde task.id_string (string) — acá se testea
  // solo la coerción con un numérico chico, sin el landmine de precisión.
  const tasks = [
    { id: '', name: 'Stage I' }, // id vacío → descartado
    { id: 12345, name: 'Stage II' }, // id numérico → string
  ]
  assert.deepEqual(detectStages(tasks), [{ zohoTaskId: '12345', name: 'Stage II' }])
})

test('detectStages normaliza el name a string trimeado', () => {
  assert.deepEqual(detectStages([{ id: 'z-t5', name: '  Stage II  ' }]), [
    { zohoTaskId: 'z-t5', name: 'Stage II' },
  ])
})
