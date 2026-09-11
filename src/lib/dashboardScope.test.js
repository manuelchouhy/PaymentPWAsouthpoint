import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allowedProjectNames, matchesClient, matchesProjectName } from './dashboardScope.js'

const masters = new Set(['HSS', 'GS3'])

test('allowedProjectNames: sin filtro de proyecto → null (sin restricción)', () => {
  assert.equal(allowedProjectNames({ projects: [], projectNumbers: [] }, []), null)
  assert.equal(allowedProjectNames({}, []), null)
})

test('allowedProjectNames: por nombre → ese set', () => {
  const s = allowedProjectNames({ projects: ['P1'], projectNumbers: [] }, [])
  assert.deepEqual([...s], ['P1'])
})

test('allowedProjectNames: por número → resuelve el nombre desde la lista de proyectos', () => {
  const projects = [
    { projectName: 'Alpha', projectNumber: 'SP-1' },
    { projectName: 'Beta', projectNumber: 'SP-2' },
  ]
  const s = allowedProjectNames({ projects: [], projectNumbers: ['SP-2'] }, projects)
  assert.deepEqual([...s], ['Beta'])
})

test('allowedProjectNames: nombre + número se unen', () => {
  const projects = [{ projectName: 'Beta', projectNumber: 'SP-2' }]
  const s = allowedProjectNames({ projects: ['P1'], projectNumbers: ['SP-2'] }, projects)
  assert.deepEqual([...s].sort(), ['Beta', 'P1'])
})

test('matchesClient: sin filtro → true', () => {
  assert.equal(matchesClient('HSS', [], masters), true)
  assert.equal(matchesClient(null, [], masters), true)
})

test('matchesClient: cliente maestro elegido matchea', () => {
  assert.equal(matchesClient('HSS', ['HSS'], masters), true)
  assert.equal(matchesClient('GS3', ['HSS'], masters), false)
})

test('matchesClient: cliente fuera del maestro (o vacío) → clave Others', () => {
  // Con "Others (not in Clients)" elegido, un cliente legacy/vacío pasa.
  const OTHERS = 'Others (not in Clients)'
  assert.equal(matchesClient('LegacyCo', [OTHERS], masters), true)
  assert.equal(matchesClient('', [OTHERS], masters), true)
  // Pero con HSS elegido, el legacy NO pasa.
  assert.equal(matchesClient('LegacyCo', ['HSS'], masters), false)
})

test('matchesProjectName: null (sin filtro) → true; con set filtra', () => {
  assert.equal(matchesProjectName('anything', null), true)
  const allowed = new Set(['Beta'])
  assert.equal(matchesProjectName('Beta', allowed), true)
  assert.equal(matchesProjectName('Alpha', allowed), false)
  assert.equal(matchesProjectName(null, allowed), false)
})
