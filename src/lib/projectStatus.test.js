import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isActiveProject, ACTIVE_PROJECT_STATUSES } from './projectStatus.js'

test('isActiveProject: proyecto de Zoho Active / In Progress → visible', () => {
  assert.equal(isActiveProject({ zohoProjectId: 'z1', zohoStatus: 'Active' }), true)
  assert.equal(isActiveProject({ zohoProjectId: 'z2', zohoStatus: 'In Progress' }), true)
})

test('isActiveProject: proyecto de Zoho On Hold / Completed / archived → oculto', () => {
  assert.equal(isActiveProject({ zohoProjectId: 'z1', zohoStatus: 'On Hold' }), false)
  assert.equal(isActiveProject({ zohoProjectId: 'z2', zohoStatus: 'Completed' }), false)
  assert.equal(isActiveProject({ zohoProjectId: 'z3', zohoStatus: 'archived' }), false)
})

test('isActiveProject: proyecto de Zoho sin estado → oculto (no es Active/In Progress)', () => {
  assert.equal(isActiveProject({ zohoProjectId: 'z1', zohoStatus: null }), false)
  assert.equal(isActiveProject({ zohoProjectId: 'z1', zohoStatus: '' }), false)
})

test('isActiveProject: proyecto MANUAL (sin zohoProjectId) → SIEMPRE visible', () => {
  // El pedido es sobre lo que trae Zoho; los creados en la app llegan con estado
  // null y no deben esconderse.
  assert.equal(isActiveProject({ zohoProjectId: null, zohoStatus: null }), true)
  assert.equal(isActiveProject({ zohoStatus: null }), true) // zohoProjectId ausente
  assert.equal(isActiveProject({ zohoProjectId: null, zohoStatus: 'Completed' }), true)
})

test('isActiveProject: comparación normalizada (mayúsculas / espacios / minúsculas)', () => {
  assert.equal(isActiveProject({ zohoProjectId: 'z', zohoStatus: 'active' }), true)
  assert.equal(isActiveProject({ zohoProjectId: 'z', zohoStatus: '  In   Progress  ' }), true)
  assert.equal(isActiveProject({ zohoProjectId: 'z', zohoStatus: 'ACTIVE' }), true)
})

test('isActiveProject: null/undefined → false (defensivo)', () => {
  assert.equal(isActiveProject(null), false)
  assert.equal(isActiveProject(undefined), false)
})

test('ACTIVE_PROJECT_STATUSES son los estados normalizados esperados', () => {
  assert.deepEqual(ACTIVE_PROJECT_STATUSES, ['active', 'in progress'])
})
