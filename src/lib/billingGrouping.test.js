import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupBillToClient, groupReadonly } from './billingGrouping.js'

// Helper: una entry bill_to_client, aprobada, 1h — se sobreescribe lo que haga falta.
const e = (o) => ({ status: 'Approved', allocation: 'bill_to_client', hours: 1, ...o })

test('agrupa bill_to_client por cliente → semana → filas', () => {
  const entries = [
    e({ id: 1, client: 'HSS', user: 'Ana', project: 'P1', task: 'T1', date: '2026-08-14', hours: 4 }),
    e({ id: 2, client: 'HSS', user: 'Ana', project: 'P1', task: 'T1', date: '2026-08-13', hours: 2 }),
    e({ id: 3, client: 'HSS', user: 'Bob', project: 'P2', task: 'T2', date: '2026-08-07', hours: 3 }),
  ]
  const [hss] = groupBillToClient(entries, {})
  assert.equal(hss.client, 'HSS')
  assert.equal(hss.hours, 9)
  assert.equal(hss.weeks.length, 2)
  // Más reciente arriba: la semana de 08-14/13 (6h), Ana·P1·T1 combinadas en 1 fila.
  assert.equal(hss.weeks[0].hours, 6)
  assert.equal(hss.weeks[0].rows.length, 1)
  assert.equal(hss.weeks[0].rows[0].hours, 6)
  assert.ok(hss.weeks[0].latestDate > hss.weeks[1].latestDate)
  assert.equal(hss.weeks[1].hours, 3)
})

test('no fusiona la misma semana ISO de años distintos', () => {
  const entries = [
    e({ id: 1, client: 'HSS', user: 'Ana', project: 'P', task: 'T', date: '2026-08-14', hours: 4 }), // W33 2026
    e({ id: 2, client: 'HSS', user: 'Ana', project: 'P', task: 'T', date: '2025-08-15', hours: 3 }), // W33 2025
  ]
  const [hss] = groupBillToClient(entries, {})
  assert.equal(hss.weeks.length, 2)
  // Ids distintos por año, y la de 2026 arriba (fecha más nueva).
  assert.notEqual(hss.weeks[0].weekId, hss.weeks[1].weekId)
  assert.equal(hss.weeks[0].weekYear, 2026)
  assert.equal(hss.weeks[1].weekYear, 2025)
})

test('ignora horas que no son bill_to_client, no aprobadas o ya facturadas', () => {
  const entries = [
    e({ id: 1, client: 'HSS', allocation: 'overage', date: '2026-08-14' }),
    e({ id: 2, client: 'HSS', status: 'Pending', date: '2026-08-14' }),
    e({ id: 3, client: 'HSS', date: '2026-08-14' }),
    e({ id: 4, client: 'HSS', date: '2026-08-14' }),
  ]
  const res = groupBillToClient(entries, { isInvoiced: (x) => x.id === 4 })
  assert.equal(res.length, 1)
  assert.equal(res[0].hours, 1) // sólo la id 3
})

test('bucket "Sin cliente" agrupado por proyecto con su motivo', () => {
  const entries = [
    e({ id: 1, client: 'HSS', date: '2026-08-14', hours: 2 }),
    e({ id: 2, client: '', clientReason: 'group-unclaimed', project: 'Px', date: '2026-08-14', hours: 5 }),
    e({ id: 3, client: '', clientReason: 'no-group', project: 'Py', date: '2026-08-14', hours: 1 }),
  ]
  const res = groupBillToClient(entries, {})
  assert.equal(res[0].isUnassigned, true)
  assert.equal(res[0].client, '')
  assert.equal(res[0].projects.length, 2)
  const px = res[0].projects.find((p) => p.project === 'Px')
  assert.equal(px.reason, 'group-unclaimed')
  assert.equal(px.hours, 5)
})

test('"Sin cliente": proyectos homónimos con motivos distintos → sin motivo único', () => {
  const entries = [
    e({ id: 1, client: '', clientReason: 'no-group', project: 'Maintenance', date: '2026-08-14' }),
    e({ id: 2, client: '', clientReason: 'group-unclaimed', project: 'Maintenance', date: '2026-08-14' }),
  ]
  const res = groupBillToClient(entries, {})
  const maint = res[0].projects.find((p) => p.project === 'Maintenance')
  assert.equal(maint.reason, null) // no muestra el motivo del primero
})

test('"Sin cliente" siempre arriba, aunque tenga menos horas', () => {
  const entries = [
    e({ id: 1, client: 'HSS', date: '2026-08-14', hours: 100 }),
    e({ id: 2, client: '', clientReason: 'no-group', project: 'Px', date: '2026-08-14', hours: 1 }),
  ]
  const res = groupBillToClient(entries, {})
  assert.equal(res[0].isUnassigned, true)
  assert.equal(res[1].client, 'HSS')
})

test('clientes con cliente ordenados por horas pendientes desc', () => {
  const entries = [
    e({ id: 1, client: 'A', date: '2026-08-14', hours: 3 }),
    e({ id: 2, client: 'B', date: '2026-08-14', hours: 10 }),
  ]
  const res = groupBillToClient(entries, {})
  assert.deepEqual(res.map((c) => c.client), ['B', 'A'])
})

test('sin entries → lista vacía', () => {
  assert.deepEqual(groupBillToClient([], {}), [])
  assert.deepEqual(groupBillToClient(undefined, {}), [])
})

// --- groupReadonly (tabs Overage / SP internal / X) -------------------------

test('groupReadonly: por contractor·semana (overage), ordena por horas desc', () => {
  const entries = [
    e({ id: 1, allocation: 'overage', user: 'Ana', project: 'P', task: 'T', date: '2026-08-14', hours: 3 }),
    e({ id: 2, allocation: 'overage', user: 'Ana', project: 'P', task: 'T', date: '2026-08-07', hours: 2 }),
    e({ id: 3, allocation: 'overage', user: 'Bob', project: 'Q', task: 'U', date: '2026-08-14', hours: 10 }),
  ]
  const res = groupReadonly(entries, 'user', { withWeeks: true })
  assert.deepEqual(res.map((r) => r.entity), ['Bob', 'Ana']) // Bob 10 > Ana 5
  const ana = res.find((r) => r.entity === 'Ana')
  assert.equal(ana.hours, 5)
  assert.equal(ana.weeks.length, 2) // W33 y W32
})

test('groupReadonly: por cliente·semana (sp_internal)', () => {
  const entries = [
    e({ id: 1, allocation: 'sp_internal', client: 'SouthPoint Internal', user: 'Ana', date: '2026-08-14', hours: 4 }),
  ]
  const [g] = groupReadonly(entries, 'client', { withWeeks: true })
  assert.equal(g.entity, 'SouthPoint Internal')
  assert.equal(g.hours, 4)
  assert.ok(Array.isArray(g.weeks))
})

test('groupReadonly: withWeeks false → filas planas (X por contractor)', () => {
  const entries = [
    e({ id: 1, allocation: 'unknown', user: 'Ana', project: 'P', task: 'T', date: '2026-08-14', hours: 2 }),
    e({ id: 2, allocation: 'unknown', user: 'Ana', project: 'P', task: 'T', date: '2026-08-13', hours: 1 }),
  ]
  const [g] = groupReadonly(entries, 'user', { withWeeks: false })
  assert.equal(g.entity, 'Ana')
  assert.equal(g.hours, 3)
  assert.equal(g.rows.length, 1) // misma terna combinada
  assert.equal(g.weeks, undefined)
})

test('groupReadonly: sólo cuenta Approved', () => {
  const entries = [
    e({ id: 1, allocation: 'overage', user: 'Ana', status: 'Pending', date: '2026-08-14', hours: 5 }),
    e({ id: 2, allocation: 'overage', user: 'Ana', status: 'Approved', date: '2026-08-14', hours: 2 }),
  ]
  const [g] = groupReadonly(entries, 'user')
  assert.equal(g.hours, 2)
})

test('groupReadonly: excluye horas ya facturadas (isInvoiced)', () => {
  const entries = [
    e({ id: 1, allocation: 'overage', user: 'Ana', date: '2026-08-14', hours: 5 }),
    e({ id: 2, allocation: 'overage', user: 'Ana', date: '2026-08-14', hours: 2 }),
  ]
  const [g] = groupReadonly(entries, 'user', { isInvoiced: (x) => x.id === 1 })
  assert.equal(g.hours, 2) // sólo la no facturada
})

test('groupReadonly: sin entries → lista vacía', () => {
  assert.deepEqual(groupReadonly([], 'user'), [])
  assert.deepEqual(groupReadonly(undefined, 'user'), [])
})
