import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildClientResolver,
  normalizeClientKey,
  NO_GROUP,
  GROUP_UNCLAIMED,
} from './clientResolver.js'

const CLIENTS = [
  { id: 1, clientName: 'HSSStaffing', zohoGroupName: 'HSS' },
  { id: 2, clientName: 'Acme Corp', zohoGroupName: null },
]

test('normalizeClientKey: minúsculas, colapsa espacios, trim', () => {
  assert.equal(normalizeClientKey('  Southpoint  Desk '), 'southpoint desk')
  assert.equal(normalizeClientKey('HSS'), 'hss')
  assert.equal(normalizeClientKey(null), '')
})

test('override manual: clientId gana sobre el grupo', () => {
  const resolve = buildClientResolver(CLIENTS)
  // El grupo diría Acme, pero el clientId manual apunta a HSSStaffing.
  const r = resolve({ clientId: 1, zohoProjectGroup: 'Acme Corp' })
  assert.deepEqual(r, { client: 'HSSStaffing', source: 'manual', reason: null })
})

test('grupo matchea por alias (HSS → HSSStaffing)', () => {
  const resolve = buildClientResolver(CLIENTS)
  const r = resolve({ zohoProjectGroup: 'HSS' })
  assert.deepEqual(r, { client: 'HSSStaffing', source: 'group', reason: null })
})

test('grupo matchea por nombre de cliente cuando no hay alias', () => {
  const resolve = buildClientResolver(CLIENTS)
  const r = resolve({ zohoProjectGroup: 'acme corp' }) // case-insensitive
  assert.deepEqual(r, { client: 'Acme Corp', source: 'group', reason: null })
})

test('grupo sin cliente que lo reclame → group-unclaimed', () => {
  const resolve = buildClientResolver(CLIENTS)
  const r = resolve({ zohoProjectGroup: 'Globex' })
  assert.deepEqual(r, { client: null, source: null, reason: GROUP_UNCLAIMED })
})

test('sin grupo y sin nada → no-group', () => {
  const resolve = buildClientResolver(CLIENTS)
  const r = resolve({ project_name: 'Huérfano' })
  assert.deepEqual(r, { client: null, source: null, reason: NO_GROUP })
})

test('texto legacy (customerName) resuelve cuando no hay clientId ni grupo', () => {
  const resolve = buildClientResolver(CLIENTS)
  const r = resolve({ customerName: 'QA Customer Corp', client: 'QA Test Client' })
  assert.deepEqual(r, { client: 'QA Customer Corp', source: 'legacy', reason: null })
})

test('texto legacy que nombra a un cliente conocido se canonicaliza (no duplica)', () => {
  const resolve = buildClientResolver(CLIENTS)
  // El proyecto trae 'hss' en el customer_name legacy; el grupo no matchea acá,
  // pero ese texto nombra al mismo cliente que 'HSS' (alias) → debe devolver el
  // nombre canónico 'HSSStaffing', no el texto crudo, para no listar dos veces al
  // mismo cliente en el dropdown de Cliente.
  const r = resolve({ customerName: '  hss ' })
  assert.deepEqual(r, { client: 'HSSStaffing', source: 'legacy', reason: null })
})

test('texto legacy sin cliente conocido sigue devolviendo el texto crudo', () => {
  const resolve = buildClientResolver(CLIENTS)
  const r = resolve({ customerName: 'Cliente Viejo Sin Alta' })
  assert.deepEqual(r, { client: 'Cliente Viejo Sin Alta', source: 'legacy', reason: null })
})

test('clientId colgado (cliente borrado) cae al grupo, no a sin-cliente', () => {
  const resolve = buildClientResolver(CLIENTS)
  const r = resolve({ clientId: 999, zohoProjectGroup: 'HSS' })
  assert.deepEqual(r, { client: 'HSSStaffing', source: 'group', reason: null })
})

test('proyecto null/undefined → no-group sin romper', () => {
  const resolve = buildClientResolver(CLIENTS)
  assert.equal(resolve(null).reason, NO_GROUP)
  assert.equal(resolve(undefined).reason, NO_GROUP)
})

test('grupo con espacio final matchea igual (normalización)', () => {
  const resolve = buildClientResolver([{ id: 3, clientName: 'Southpoint Desk' }])
  const r = resolve({ zohoProjectGroup: 'Southpoint Desk ' })
  assert.equal(r.client, 'Southpoint Desk')
})

test('clave reclamada por dos clientes distintos → ambigua, no adivina', () => {
  // Un cliente se llama 'HSS'; otro pone 'HSS' como alias de grupo. La misma
  // clave normalizada apunta a dos clientes → no se asigna al último cargado.
  const resolve = buildClientResolver([
    { id: 1, clientName: 'HSS' },
    { id: 2, clientName: 'Acme Corp', zohoGroupName: 'HSS' },
  ])
  const r = resolve({ zohoProjectGroup: 'HSS' })
  assert.deepEqual(r, { client: null, source: null, reason: GROUP_UNCLAIMED })
})

test('el override manual sigue resolviendo aunque la clave del grupo sea ambigua', () => {
  const resolve = buildClientResolver([
    { id: 1, clientName: 'HSS' },
    { id: 2, clientName: 'Acme Corp', zohoGroupName: 'HSS' },
  ])
  const r = resolve({ clientId: 2, zohoProjectGroup: 'HSS' })
  assert.deepEqual(r, { client: 'Acme Corp', source: 'manual', reason: null })
})
