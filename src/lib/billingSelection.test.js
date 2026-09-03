import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canBillSelection,
  billBlockReason,
  contractorsFromSelection,
  remainingHoursByContractor,
  weekStartFromSelection,
  projectsForContractWarnings,
} from './billingSelection.js'

// Una fila facturable = un log. Helper con overrides.
const row = (o) => ({
  user: 'Ana',
  client: 'HSS',
  project: 'P1',
  date: '2026-08-12', // miércoles → semana del domingo 2026-08-09
  hours: 1,
  entries: [{ id: o?.id ?? 1, hours: o?.hours ?? 1, date: o?.date ?? '2026-08-12' }],
  ...o,
})

test('canBillSelection: un cliente + un proyecto + entries → true', () => {
  const sel = [
    row({ id: 1, user: 'Ana', hours: 4 }),
    row({ id: 2, user: 'Bob', hours: 3 }),
  ]
  assert.equal(canBillSelection(sel), true)
})

test('canBillSelection: sin entries → false', () => {
  assert.equal(canBillSelection([]), false)
})

test('canBillSelection: cruza cliente → false', () => {
  const sel = [row({ id: 1, client: 'HSS' }), row({ id: 2, client: 'ACME' })]
  assert.equal(canBillSelection(sel), false)
})

test('canBillSelection: cruza proyecto → false', () => {
  const sel = [row({ id: 1, project: 'P1' }), row({ id: 2, project: 'P2' })]
  assert.equal(canBillSelection(sel), false)
})

test('billBlockReason: multi-cliente y multi-proyecto → cliente tiene precedencia', () => {
  const sel = [row({ id: 1, client: 'HSS', project: 'P1' }), row({ id: 2, client: 'ACME', project: 'P2' })]
  assert.equal(billBlockReason(sel), 'multi-client')
})

test('billBlockReason: multi-proyecto → multi-project; selección válida → null', () => {
  assert.equal(billBlockReason([row({ id: 1, project: 'P1' }), row({ id: 2, project: 'P2' })]), 'multi-project')
  assert.equal(billBlockReason([row({ id: 1 }), row({ id: 2 })]), null)
})

test('sin proyecto (bucket "—") no se factura: canBill false + reason no-project', () => {
  const sel = [row({ id: 1, project: '' })]
  assert.equal(canBillSelection(sel), false)
  assert.equal(billBlockReason(sel), 'no-project')
  // Mezclar una fila sin proyecto con una de P1 NO cuela (antes se filtraba el '').
  const mixed = [row({ id: 1, project: '' }), row({ id: 2, project: 'P1' })]
  assert.equal(canBillSelection(mixed), false)
  assert.equal(billBlockReason(mixed), 'multi-project')
})

test('cruzar semanas no se factura: canBill false + reason multi-week', () => {
  const sel = [row({ id: 1, date: '2026-08-12' }), row({ id: 2, date: '2026-08-05' })]
  assert.equal(canBillSelection(sel), false)
  assert.equal(billBlockReason(sel), 'multi-week')
})

test('sin fecha resoluble: canBill false + reason no-week (no queda sin explicación)', () => {
  const sel = [{ user: 'Ana', client: 'HSS', project: 'P1', hours: 1, entries: [{ id: 1, hours: 1, date: '' }] }]
  assert.equal(canBillSelection(sel), false)
  assert.equal(billBlockReason(sel), 'no-week')
})

test('una fila con fecha y otra sin fecha: no-week (no el engañoso multi-week)', () => {
  const sel = [
    row({ id: 1, date: '2026-08-12' }),
    { user: 'Ana', client: 'HSS', project: 'P1', hours: 1, entries: [{ id: 2, hours: 1, date: '' }] },
  ]
  assert.equal(billBlockReason(sel), 'no-week')
})

test('selección vacía: sin motivo de bloqueo (no hay nada que avisar)', () => {
  assert.equal(billBlockReason([]), null)
})

test('fila sin contractor: canBill false + reason no-contractor (no descuadra totales)', () => {
  const sel = [row({ id: 1, user: '' })]
  assert.equal(canBillSelection(sel), false)
  assert.equal(billBlockReason(sel), 'no-contractor')
})

test('sin cliente resuelto: canBill false + reason no-client', () => {
  const sel = [row({ id: 1, client: '' })]
  assert.equal(canBillSelection(sel), false)
  assert.equal(billBlockReason(sel), 'no-client')
})

test('contractorsFromSelection: orden por horas y estructura de entries', () => {
  const sel = [
    row({ id: 1, user: 'Ana', hours: 4 }),
    row({ id: 2, user: 'Ana', hours: 2 }),
    row({ id: 3, user: 'Bob', hours: 5 }),
  ]
  const out = contractorsFromSelection(sel)
  assert.deepEqual(out.map((c) => c.contractor), ['Ana', 'Bob'])
  const ana = out.find((c) => c.contractor === 'Ana')
  assert.equal(ana.hours, 6)
  assert.deepEqual(ana.entries.map((e) => e.id), [1, 2])
})

test('remainingHoursByContractor: pendiente por unidad (cliente+proyecto+semana) por contractor', () => {
  // Filas de HSS / P1 / semana del 2026-08-09 (date 2026-08-12).
  const sel = [row({ id: 1, user: 'Ana', hours: 4 }), row({ id: 2, user: 'Bob', hours: 3 })]
  const pending = new Map([
    ['HSS||P1||2026-08-09||Ana', 10], // Ana: 10 pendientes en la unidad, factura 4 → 6
    ['HSS||P1||2026-08-09||Bob', 3], //  Bob: 3 pendientes, factura 3 → 0 (no aparece)
    ['HSS||P2||2026-08-09||Ana', 5], //  otra unidad (P2): NO cuenta para esta factura
  ])
  const out = remainingHoursByContractor(sel, pending)
  assert.deepEqual(out, [{ contractor: 'Ana', remaining: 6 }])
})

test('remainingHoursByContractor: multi-cliente → []', () => {
  const sel = [row({ id: 1, client: 'HSS' }), row({ id: 2, client: 'ACME' })]
  assert.deepEqual(remainingHoursByContractor(sel, new Map()), [])
})

test('weekStartFromSelection: una sola semana → domingo ISO; varias → null', () => {
  const oneWeek = [row({ id: 1, date: '2026-08-12' }), row({ id: 2, date: '2026-08-09' })]
  assert.equal(weekStartFromSelection(oneWeek), '2026-08-09')
  const twoWeeks = [row({ id: 1, date: '2026-08-12' }), row({ id: 2, date: '2026-08-05' })]
  assert.equal(weekStartFromSelection(twoWeeks), null)
})

// Resolver de juguete: mapea projects.client crudo/alias → cliente maestro, para
// simular el buildClientResolver real (proyecto → cliente) sin cargarlo entero.
const resolverFrom = (rawToMaster) => (project) => ({
  client: rawToMaster[project?.client] ?? null,
})
// Entry de la selección con override (id de proyecto y/o nombre).
const ent = (o) => ({ zohoProjectId: o?.zohoProjectId, project: o?.project })

test('projectsForContractWarnings: join por zohoProjectId — homónimo se resuelve por id, no por nombre', () => {
  // Dos "Support" bajo clientes distintos: se factura el id 'z1'. El match por id
  // identifica LA fila exacta sin depender del nombre ni del cliente.
  const projects = [
    { id: 1, projectName: 'Support', client: 'HSS Group', zohoProjectId: 'z1' },
    { id: 2, projectName: 'Support', client: 'Acme Inc', zohoProjectId: 'z2' },
  ]
  const resolve = resolverFrom({ 'HSS Group': 'HSS', 'Acme Inc': 'Acme' })
  const out = projectsForContractWarnings(projects, [ent({ zohoProjectId: 'z1', project: 'Support' })], 'HSS', resolve)
  assert.deepEqual(out.map((p) => p.id), [1])
})

test('projectsForContractWarnings: join por id sobrevive a rename del proyecto', () => {
  // La hora trae el nombre viejo; el proyecto fue renombrado. El id sigue matcheando.
  const projects = [{ id: 5, projectName: 'Nombre Nuevo', client: 'HSS', zohoProjectId: 'z9' }]
  const resolve = resolverFrom({ HSS: 'HSS' })
  const out = projectsForContractWarnings(projects, [ent({ zohoProjectId: 'z9', project: 'Nombre Viejo' })], 'HSS', resolve)
  assert.deepEqual(out.map((p) => p.id), [5])
})

test('projectsForContractWarnings: match por id NO duplica banners para un mismo proyecto', () => {
  // Un solo id facturado → un solo proyecto, aunque exista otro homónimo por nombre.
  const projects = [
    { id: 1, projectName: 'Support', client: 'HSS', zohoProjectId: 'z1' },
    { id: 2, projectName: 'Support', client: 'HSS', zohoProjectId: 'z2' },
  ]
  const resolve = resolverFrom({ HSS: 'HSS' })
  const out = projectsForContractWarnings(projects, [ent({ zohoProjectId: 'z1', project: 'Support' })], 'HSS', resolve)
  assert.deepEqual(out.map((p) => p.id), [1])
})

test('projectsForContractWarnings: id ausente en projects → NO cae a fallback por nombre (no atribuye contrato ajeno)', () => {
  // La hora trae id 'zX' que no está en projects (anomalía de sync: misma fuente que
  // asignó el id). Un homónimo presente NO se usa: mejor no avisar que avisar con el
  // contrato de un proyecto distinto. Ver docstring de projectsForContractWarnings.
  const projects = [{ id: 7, projectName: 'Support', client: 'HSS Group' }]
  const resolve = resolverFrom({ 'HSS Group': 'HSS' })
  const out = projectsForContractWarnings(projects, [ent({ zohoProjectId: 'zX', project: 'Support' })], 'HSS', resolve)
  assert.deepEqual(out, [])
})

test('projectsForContractWarnings: id presente → su nombre NO entra al fallback (sin banner duplicado)', () => {
  // Se factura z1 (presente). Existe un homónimo z2 del mismo cliente. Sólo z1 avisa:
  // el nombre 'Support' no se suma al fallback porque su id está presente.
  const projects = [
    { id: 1, projectName: 'Support', client: 'HSS', zohoProjectId: 'z1' },
    { id: 2, projectName: 'Support', client: 'HSS', zohoProjectId: 'z2' },
  ]
  const resolve = resolverFrom({ HSS: 'HSS' })
  const out = projectsForContractWarnings(projects, [ent({ zohoProjectId: 'z1', project: 'Support' })], 'HSS', resolve)
  assert.deepEqual(out.map((p) => p.id), [1])
})

test('projectsForContractWarnings: fallback por nombre (sin id) — descarta el de OTRO cliente', () => {
  // Horas legacy sin zohoProjectId: cae al match por nombre + cliente maestro.
  const projects = [
    { id: 1, projectName: 'Support', client: 'HSS Group' },
    { id: 2, projectName: 'Support', client: 'Acme Inc' },
  ]
  const resolve = resolverFrom({ 'HSS Group': 'HSS', 'Acme Inc': 'Acme' })
  const out = projectsForContractWarnings(projects, [ent({ project: 'Support' })], 'HSS', resolve)
  assert.deepEqual(out.map((p) => p.id), [1])
})

test('projectsForContractWarnings: fallback por nombre — único de OTRO cliente → se descarta', () => {
  const projects = [{ id: 9, projectName: 'Analytics Platform', client: 'Acme Analytics' }]
  const resolve = resolverFrom({ 'Acme Analytics': 'Acme' })
  const out = projectsForContractWarnings(projects, [ent({ project: 'Analytics Platform' })], 'HSS', resolve)
  assert.deepEqual(out, [])
})

test('projectsForContractWarnings: fallback por nombre — resuelve a null (incierto) → se INCLUYE (fail-safe)', () => {
  const projects = [{ id: 3, projectName: 'Legacy', client: 'texto viejo' }]
  const resolve = resolverFrom({}) // nada matchea → null
  const out = projectsForContractWarnings(projects, [ent({ project: 'Legacy' })], 'HSS', resolve)
  assert.deepEqual(out.map((p) => p.id), [3])
})

test('projectsForContractWarnings: fallback sin cliente o sin resolver → match sólo por nombre', () => {
  const projects = [
    { id: 1, projectName: 'P1', client: 'x' },
    { id: 2, projectName: 'P2', client: 'y' },
  ]
  const resolve = resolverFrom({ x: 'OtroCliente', y: 'OtroCliente' })
  assert.deepEqual(
    projectsForContractWarnings(projects, [ent({ project: 'P1' }), ent({ project: 'P2' })], null, resolve).map((p) => p.id),
    [1, 2],
  )
  assert.deepEqual(
    projectsForContractWarnings(projects, [ent({ project: 'P1' })], 'HSS', null).map((p) => p.id),
    [1],
  )
})
