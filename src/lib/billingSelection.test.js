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

test('projectsForContractWarnings: homónimo — descarta el de OTRO cliente, conserva el del maestro', () => {
  // "Support" existe bajo dos clientes; el crudo ("HSS Group"/"Acme Inc") NO iguala
  // al maestro ("HSS"/"Acme"), pero el resolver los canonicaliza y el match funciona.
  const projects = [
    { id: 1, projectName: 'Support', client: 'HSS Group' },
    { id: 2, projectName: 'Support', client: 'Acme Inc' },
  ]
  const resolve = resolverFrom({ 'HSS Group': 'HSS', 'Acme Inc': 'Acme' })
  const out = projectsForContractWarnings(projects, new Set(['Support']), 'HSS', resolve)
  assert.deepEqual(out.map((p) => p.id), [1])
})

test('projectsForContractWarnings: nombre único de OTRO cliente → se descarta (no avisa con contrato ajeno)', () => {
  const projects = [{ id: 9, projectName: 'Analytics Platform', client: 'Acme Analytics' }]
  const resolve = resolverFrom({ 'Acme Analytics': 'Acme' })
  const out = projectsForContractWarnings(projects, new Set(['Analytics Platform']), 'HSS', resolve)
  assert.deepEqual(out, [])
})

test('projectsForContractWarnings: resuelve a null (incierto) → se INCLUYE (fail-safe, no oculta vencimiento)', () => {
  const projects = [{ id: 3, projectName: 'Legacy', client: 'texto viejo' }]
  const resolve = resolverFrom({}) // nada matchea → null
  const out = projectsForContractWarnings(projects, new Set(['Legacy']), 'HSS', resolve)
  assert.deepEqual(out.map((p) => p.id), [3])
})

test('projectsForContractWarnings: sin cliente o sin resolver → match sólo por nombre', () => {
  const projects = [
    { id: 1, projectName: 'P1', client: 'x' },
    { id: 2, projectName: 'P2', client: 'y' },
  ]
  const resolve = resolverFrom({ x: 'OtroCliente', y: 'OtroCliente' })
  // Sin client: no se puede filtrar por maestro → los dos por nombre.
  assert.deepEqual(
    projectsForContractWarnings(projects, new Set(['P1', 'P2']), null, resolve).map((p) => p.id),
    [1, 2],
  )
  // Con client pero sin resolver: también sólo por nombre.
  assert.deepEqual(
    projectsForContractWarnings(projects, new Set(['P1']), 'HSS', null).map((p) => p.id),
    [1],
  )
})

test('projectsForContractWarnings: acepta un iterable de nombres, no sólo Set', () => {
  const projects = [{ id: 1, projectName: 'P1', client: 'x' }]
  const resolve = resolverFrom({ x: 'HSS' })
  const out = projectsForContractWarnings(projects, ['P1'], 'HSS', resolve)
  assert.deepEqual(out.map((p) => p.id), [1])
})
