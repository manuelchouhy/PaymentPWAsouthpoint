import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildProjectIndex,
  findProjectForEntry,
  deriveEntriesClient,
} from './entryClient.js'

const PROJECTS = [
  { zohoProjectId: '100', projectName: 'KBS Orders', zohoProjectGroup: 'HSS' },
  { zohoProjectId: '200', projectName: 'Internal', zohoProjectGroup: null, customerName: 'Southpoint' },
  // Dos proyectos homónimos de clientes distintos → nombre ambiguo.
  { zohoProjectId: '300', projectName: 'Maintenance', zohoProjectGroup: 'HSS' },
  { zohoProjectId: '400', projectName: 'Maintenance', zohoProjectGroup: 'Acme' },
]
const CLIENTS = [
  { id: 1, clientName: 'HSSStaffing', zohoGroupName: 'HSS' },
  { id: 2, clientName: 'Acme Corp', zohoGroupName: 'Acme' },
]

test('buildProjectIndex: nombre homónimo se marca ambiguo (null)', () => {
  const idx = buildProjectIndex(PROJECTS)
  assert.equal(idx.byZohoId.size, 4)
  assert.equal(idx.byName.get('KBS Orders').zohoProjectId, '100')
  assert.equal(idx.byName.get('Maintenance'), null) // ambiguo
})

test('findProjectForEntry: une por id de Zoho aunque el nombre difiera', () => {
  const idx = buildProjectIndex(PROJECTS)
  // La hora trae el nombre viejo tras un rename, pero el id manda.
  const p = findProjectForEntry({ zohoProjectId: '100', project: 'KBS Orders (old name)' }, idx)
  assert.equal(p.zohoProjectId, '100')
})

test('findProjectForEntry: sin id, cae al nombre si es inequívoco', () => {
  const idx = buildProjectIndex(PROJECTS)
  const p = findProjectForEntry({ project: 'KBS Orders' }, idx)
  assert.equal(p.zohoProjectId, '100')
})

test('findProjectForEntry: nombre ambiguo → null (no adivina)', () => {
  const idx = buildProjectIndex(PROJECTS)
  assert.equal(findProjectForEntry({ project: 'Maintenance' }, idx), null)
})

test('findProjectForEntry: id presente pero inexistente → null (no cae al nombre)', () => {
  const idx = buildProjectIndex(PROJECTS)
  // La hora trae un zohoProjectId que no está en el índice; su nombre matchea
  // por casualidad OTRO proyecto ('Internal' → 200). Con el id como autoritativo
  // NO se atribuye al proyecto equivocado: devuelve null.
  const p = findProjectForEntry({ zohoProjectId: '999', project: 'Internal' }, idx)
  assert.equal(p, null)
})

test('deriveEntriesClient: resuelve por id de Zoho → grupo → cliente', () => {
  const [e] = deriveEntriesClient([{ id: 'e1', zohoProjectId: '100', project: 'KBS Orders' }], PROJECTS, CLIENTS)
  assert.equal(e.client, 'HSSStaffing')
  assert.equal(e.clientReason, null)
})

test('deriveEntriesClient: el valor propio de la entry gana', () => {
  const [e] = deriveEntriesClient([{ id: 'e2', zohoProjectId: '100', client: 'Cliente Zoho' }], PROJECTS, CLIENTS)
  assert.equal(e.client, 'Cliente Zoho')
})

test('deriveEntriesClient: hora de proyecto homónimo queda sin cliente (no el equivocado)', () => {
  const [e] = deriveEntriesClient([{ id: 'e3', project: 'Maintenance' }], PROJECTS, CLIENTS)
  assert.equal(e.client, '')
})

test('deriveEntriesClient: proyecto inexistente → sin cliente, motivo no-group', () => {
  const [e] = deriveEntriesClient([{ id: 'e4', project: 'Fantasma' }], PROJECTS, CLIENTS)
  assert.equal(e.client, '')
  assert.equal(e.clientReason, 'no-group')
})

test('deriveEntriesClient: grupo sin cliente que lo reclame → group-unclaimed', () => {
  const projects = [{ zohoProjectId: '500', projectName: 'Orphan', zohoProjectGroup: 'Globex' }]
  const [e] = deriveEntriesClient([{ id: 'e5', zohoProjectId: '500', project: 'Orphan' }], projects, CLIENTS)
  assert.equal(e.client, '')
  assert.equal(e.clientReason, 'group-unclaimed')
})
