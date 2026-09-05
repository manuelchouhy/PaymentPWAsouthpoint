import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildProjectIndex,
  findProjectForEntry,
  deriveEntriesClient,
  makeProjectFilterLabeler,
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

test('findProjectForEntry: id presente pero inexistente → null (id autoritativo)', () => {
  const idx = buildProjectIndex(PROJECTS)
  // El id no está en el índice. Como byZohoId y byName salen de la MISMA lista, el
  // proyecto tampoco está en byName; caer al nombre sólo devolvería OTRO proyecto
  // homónimo ('Internal' → 200, otro cliente). Se prefiere null al cliente errado.
  assert.equal(findProjectForEntry({ zohoProjectId: '999', project: 'Internal' }, idx), null)
})

test('findProjectForEntry: zohoProjectId "" cuenta como ausente → usa el nombre', () => {
  const idx = buildProjectIndex(PROJECTS)
  const p = findProjectForEntry({ zohoProjectId: '', project: 'KBS Orders' }, idx)
  assert.equal(p.zohoProjectId, '100')
})

test('deriveEntriesClient: resuelve por id de Zoho → grupo → cliente', () => {
  const [e] = deriveEntriesClient([{ id: 'e1', zohoProjectId: '100', project: 'KBS Orders' }], PROJECTS, CLIENTS)
  assert.equal(e.client, 'HSSStaffing')
})

test('deriveEntriesClient: el valor propio de la entry gana', () => {
  const [e] = deriveEntriesClient([{ id: 'e2', zohoProjectId: '100', client: 'Cliente Zoho' }], PROJECTS, CLIENTS)
  assert.equal(e.client, 'Cliente Zoho')
})

test('deriveEntriesClient: el cliente propio de Zoho se canonicaliza (no duplica)', () => {
  // Zoho manda la hora con 'hss' (minúsculas, espacios) — el mismo cliente que el
  // proyecto resuelve como 'HSSStaffing'. Sin canonicalizar, el filtro listaba
  // ambos; ahora colapsa al nombre canónico.
  const [e] = deriveEntriesClient([{ id: 'e2b', client: '  hss ' }], PROJECTS, CLIENTS)
  assert.equal(e.client, 'HSSStaffing')
  assert.equal(e.clientReason, null)
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

test('deriveEntriesClient: grupo sin cliente que lo reclame → sin cliente, motivo group-unclaimed', () => {
  const projects = [{ zohoProjectId: '500', projectName: 'Orphan', zohoProjectGroup: 'Globex' }]
  const [e] = deriveEntriesClient([{ id: 'e5', zohoProjectId: '500', project: 'Orphan' }], projects, CLIENTS)
  assert.equal(e.client, '')
  assert.equal(e.clientReason, 'group-unclaimed')
})

test('deriveEntriesClient: entry con cliente propio → clientReason null', () => {
  const [e] = deriveEntriesClient([{ id: 'e6', client: 'Cliente Zoho', project: 'x' }], PROJECTS, CLIENTS)
  assert.equal(e.client, 'Cliente Zoho')
  assert.equal(e.clientReason, null)
})

test('makeProjectFilterLabeler: antepone el número; sólo el nombre si falta o es ambiguo', () => {
  const projects = [
    { zohoProjectId: '1', projectName: 'Alpha', projectNumber: 'PRJ-1' },
    { zohoProjectId: '2', projectName: 'Beta' }, // sin número
    // Homónimo → byName null → sin número aunque alguno tenga.
    { zohoProjectId: '3', projectName: 'Dup', projectNumber: 'PRJ-3' },
    { zohoProjectId: '4', projectName: 'Dup', projectNumber: 'PRJ-4' },
  ]
  const label = makeProjectFilterLabeler(projects)
  assert.equal(label('Alpha'), 'PRJ-1 · Alpha')
  assert.equal(label('Beta'), 'Beta')
  assert.equal(label('Dup'), 'Dup') // ambiguo: sólo el nombre
  assert.equal(label('Fantasma'), 'Fantasma') // no existe: se devuelve tal cual
})
