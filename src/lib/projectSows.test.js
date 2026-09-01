import { test } from 'node:test'
import assert from 'node:assert/strict'
import { projectSows } from './projectSows.js'

test('combina el SOW de proyecto con los de stage', () => {
  assert.deepEqual(
    projectSows({ sowNumber: 'SOW-100', stageSowNumbers: ['SOW-200', 'SOW-300'] }),
    ['SOW-100', 'SOW-200', 'SOW-300'],
  )
})

test('deduplica cuando un SOW de stage repite el de proyecto', () => {
  assert.deepEqual(
    projectSows({ sowNumber: 'SOW-100', stageSowNumbers: ['SOW-100', 'SOW-200'] }),
    ['SOW-100', 'SOW-200'],
  )
})

test('deduplica SOW de stage repetidos entre sí', () => {
  assert.deepEqual(
    projectSows({ sowNumber: null, stageSowNumbers: ['SOW-200', 'SOW-200'] }),
    ['SOW-200'],
  )
})

test('descarta nulls y vacíos (sowNumber null / stage sin SOW)', () => {
  assert.deepEqual(
    projectSows({ sowNumber: null, stageSowNumbers: ['SOW-200', null, ''] }),
    ['SOW-200'],
  )
})

test('proyecto sin stages: solo el SOW de proyecto', () => {
  assert.deepEqual(projectSows({ sowNumber: 'SOW-100' }), ['SOW-100'])
})

test('proyecto sin ningún SOW: lista vacía', () => {
  assert.deepEqual(projectSows({ sowNumber: null, stageSowNumbers: [] }), [])
  assert.deepEqual(projectSows({}), [])
})
