import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attributeHoursByStage } from './stageHourAttribution.js'

const E = (id, taskNumber, hours) => ({ id, taskNumber, hours })

test('atribuye horas al stage de su task; las no mapeadas van a noStage', () => {
  const entries = [
    E(1, 'T-100', 2),
    E(2, 'T-100', 3),
    E(3, 'T-200', 4),
    E(4, 'T-999', 1), // task sin stage → noStage
  ]
  const taskToStage = { 'T-100': 'S1', 'T-200': 'S2' }
  const { byStage, noStage } = attributeHoursByStage(entries, taskToStage)
  assert.equal(byStage.S1.hours, 5)
  assert.deepEqual(byStage.S1.entryIds, ['1', '2'])
  assert.equal(byStage.S2.hours, 4)
  assert.equal(noStage.hours, 1)
  assert.deepEqual(noStage.entryIds, ['4'])
})

test('acepta taskToStage como Map', () => {
  const entries = [E(1, 'T-1', 5)]
  const taskToStage = new Map([['T-1', 'S9']])
  const { byStage } = attributeHoursByStage(entries, taskToStage)
  assert.equal(byStage.S9.hours, 5)
})

test('stageId numérico se normaliza a string como clave', () => {
  const entries = [E(1, 'T-1', 5)]
  const { byStage } = attributeHoursByStage(entries, { 'T-1': 7 })
  assert.equal(byStage['7'].hours, 5)
})

test('taskNumber numérico se matchea como string', () => {
  const entries = [{ id: 1, taskNumber: 1003, hours: 2 }]
  const { byStage } = attributeHoursByStage(entries, { '1003': 'S1' })
  assert.equal(byStage.S1.hours, 2)
})

test('horas no numéricas aportan 0 (no NaN)', () => {
  const entries = [E(1, 'T-1', 'x'), E(2, 'T-1', 3)]
  const { byStage } = attributeHoursByStage(entries, { 'T-1': 'S1' })
  assert.equal(byStage.S1.hours, 3)
})

test('entry sin taskNumber → noStage', () => {
  const entries = [{ id: 1, hours: 4 }]
  const { byStage, noStage } = attributeHoursByStage(entries, { 'T-1': 'S1' })
  assert.deepEqual(byStage, {})
  assert.equal(noStage.hours, 4)
})

test('entradas vacías → byStage vacío y noStage en 0', () => {
  const { byStage, noStage } = attributeHoursByStage([], {})
  assert.deepEqual(byStage, {})
  assert.equal(noStage.hours, 0)
  assert.deepEqual(noStage.entryIds, [])
})

test('sin taskToStage todo cae en noStage (defensivo)', () => {
  const { byStage, noStage } = attributeHoursByStage([E(1, 'T-1', 2)])
  assert.deepEqual(byStage, {})
  assert.equal(noStage.hours, 2)
})

test('Map con claves NUMÉRICAS también matchea (se normalizan a string)', () => {
  const entries = [{ id: 1, taskNumber: 1003, hours: 2 }]
  const taskToStage = new Map([[1003, 'S1']]) // clave numérica
  const { byStage, noStage } = attributeHoursByStage(entries, taskToStage)
  assert.equal(byStage.S1.hours, 2)
  assert.equal(noStage.hours, 0)
})

test('stageId cadena vacía → noStage (no un bucket fantasma)', () => {
  const { byStage, noStage } = attributeHoursByStage([E(1, 'T-1', 3)], { 'T-1': '' })
  assert.deepEqual(byStage, {})
  assert.equal(noStage.hours, 3)
})

test('entries null no rompe (se trata como vacío)', () => {
  const { byStage, noStage } = attributeHoursByStage(null, { 'T-1': 'S1' })
  assert.deepEqual(byStage, {})
  assert.equal(noStage.hours, 0)
})

test('elemento null dentro de la lista se saltea (no ensucia entryIds)', () => {
  const { byStage, noStage } = attributeHoursByStage([null, E(2, 'T-1', 3)], { 'T-1': 'S1' })
  assert.equal(byStage.S1.hours, 3)
  assert.deepEqual(byStage.S1.entryIds, ['2'])
  assert.deepEqual(noStage.entryIds, [])
})

test('la suma total de horas se conserva (byStage + noStage)', () => {
  const entries = [E(1, 'T-1', 2), E(2, 'T-2', 3), E(3, 'T-9', 4)]
  const { byStage, noStage } = attributeHoursByStage(entries, { 'T-1': 'S1', 'T-2': 'S1' })
  const total = Object.values(byStage).reduce((s, b) => s + b.hours, 0) + noStage.hours
  assert.equal(total, 9)
})
