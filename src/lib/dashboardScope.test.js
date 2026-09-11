import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchesClient, matchesProjectFilter } from './dashboardScope.js'

const masters = new Set(['HSS', 'GS3'])
// Resolver de juguete: proyecto.client crudo → cliente maestro (simula buildClientResolver).
const resolver = (rawToMaster) => (p) => ({ client: rawToMaster[p?.client] ?? p?.client ?? null })

test('matchesClient: sin filtro → true', () => {
  assert.equal(matchesClient('HSS', [], masters), true)
  assert.equal(matchesClient(null, [], masters), true)
})

test('matchesClient: cliente maestro elegido matchea', () => {
  assert.equal(matchesClient('HSS', ['HSS'], masters), true)
  assert.equal(matchesClient('GS3', ['HSS'], masters), false)
})

test('matchesClient: fuera del maestro (o vacío) → clave Others', () => {
  const OTHERS = 'Others (not in Clients)'
  assert.equal(matchesClient('LegacyCo', [OTHERS], masters), true)
  assert.equal(matchesClient('', [OTHERS], masters), true)
  assert.equal(matchesClient('LegacyCo', ['HSS'], masters), false)
})

test('matchesProjectFilter: sin filtros → true', () => {
  const p = { projectName: 'Alpha', projectNumber: 'SP-1', client: 'HSS' }
  assert.equal(matchesProjectFilter(p, {}, masters, resolver({})), true)
})

test('matchesProjectFilter: cliente resuelto (no el crudo) decide', () => {
  // El crudo es un alias legacy 'Velociti' que resuelve a GS3.
  const p = { projectName: 'Alpha', projectNumber: 'SP-1', client: 'Velociti' }
  const res = resolver({ Velociti: 'GS3' })
  assert.equal(matchesProjectFilter(p, { clients: ['GS3'] }, masters, res), true)
  assert.equal(matchesProjectFilter(p, { clients: ['HSS'] }, masters, res), false)
})

test('matchesProjectFilter: Proyecto y Project# se INTERSECTAN (AND), no se unen', () => {
  const alpha = { projectName: 'Alpha', projectNumber: 'SP-1', client: 'HSS' }
  const beta = { projectName: 'Beta', projectNumber: 'SP-2', client: 'HSS' }
  const filters = { projects: ['Alpha'], projectNumbers: ['SP-2'] }
  // Alpha matchea el nombre pero no el número; Beta el número pero no el nombre → ninguno.
  assert.equal(matchesProjectFilter(alpha, filters, masters, resolver({})), false)
  assert.equal(matchesProjectFilter(beta, filters, masters, resolver({})), false)
  // Con nombre y número del MISMO proyecto → true.
  assert.equal(
    matchesProjectFilter(alpha, { projects: ['Alpha'], projectNumbers: ['SP-1'] }, masters, resolver({})),
    true,
  )
})

test('matchesProjectFilter: sin resolveClient cae al project.client crudo', () => {
  const p = { projectName: 'Alpha', projectNumber: 'SP-1', client: 'HSS' }
  assert.equal(matchesProjectFilter(p, { clients: ['HSS'] }, masters, undefined), true)
  assert.equal(matchesProjectFilter(p, { clients: ['GS3'] }, masters, undefined), false)
})

test('matchesProjectFilter: sólo por nombre / sólo por número', () => {
  const beta = { projectName: 'Beta', projectNumber: 'SP-2', client: 'HSS' }
  assert.equal(matchesProjectFilter(beta, { projects: ['Beta'] }, masters, resolver({})), true)
  assert.equal(matchesProjectFilter(beta, { projects: ['Alpha'] }, masters, resolver({})), false)
  assert.equal(matchesProjectFilter(beta, { projectNumbers: ['SP-2'] }, masters, resolver({})), true)
  assert.equal(matchesProjectFilter(beta, { projectNumbers: ['SP-9'] }, masters, resolver({})), false)
})
