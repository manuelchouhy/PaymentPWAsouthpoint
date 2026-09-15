import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bucketEntriesByPeriod } from './paymentsPeriodBuckets.js'
import { formatMonth } from './format.js'

const E = (id, date, hours) => ({ id, date, hours })

test('total → un solo bucket con todas las horas', () => {
  const entries = [E(1, '2026-09-06', 2), E(2, '2026-08-30', 3)]
  const buckets = bucketEntriesByPeriod(entries, 'total')
  assert.equal(buckets.length, 1)
  assert.equal(buckets[0].key, 'all')
  assert.equal(buckets[0].label, 'All pending')
  assert.deepEqual(buckets[0].entryIds, ['1', '2'])
  assert.equal(buckets[0].hours, 5)
})

test('total con lista vacía → sin buckets', () => {
  assert.deepEqual(bucketEntriesByPeriod([], 'total'), [])
})

test('modo por defecto es total', () => {
  const buckets = bucketEntriesByPeriod([E(1, '2026-09-06', 2)])
  assert.equal(buckets.length, 1)
  assert.equal(buckets[0].key, 'all')
})

test('month → un bucket por YYYY-MM, orden descendente, label "Mon YYYY"', () => {
  const entries = [
    E(1, '2026-08-15', 1),
    E(2, '2026-09-06', 2),
    E(3, '2026-09-20', 3),
  ]
  const buckets = bucketEntriesByPeriod(entries, 'month')
  assert.equal(buckets.length, 2)
  // Más reciente primero.
  assert.equal(buckets[0].key, '2026-09')
  assert.equal(buckets[0].label, formatMonth('2026-09'))
  assert.equal(buckets[0].hours, 5)
  assert.deepEqual(buckets[0].entryIds, ['2', '3'])
  assert.equal(buckets[1].key, '2026-08')
  assert.equal(buckets[1].hours, 1)
})

test('week → un bucket por domingo, label rango dom→sáb', () => {
  // 2026-09-06 es domingo; su semana va 09-06 a 09-12.
  const entries = [E(1, '2026-09-06', 2), E(2, '2026-09-12', 1), E(3, '2026-09-13', 4)]
  const buckets = bucketEntriesByPeriod(entries, 'week')
  assert.equal(buckets.length, 2)
  // La semana del 13 (domingo 09-13) es más reciente → primero.
  assert.equal(buckets[0].key, '2026-09-13')
  assert.equal(buckets[0].label, '09-13-2026 to 09-19-2026')
  assert.equal(buckets[0].hours, 4)
  assert.equal(buckets[1].key, '2026-09-06')
  assert.equal(buckets[1].hours, 3)
  assert.deepEqual(buckets[1].entryIds, ['1', '2'])
})

test('horas sin fecha → bucket no-date, SIEMPRE último, no se pierden', () => {
  const entries = [E(1, null, 2), E(2, '2026-09-06', 3)]
  const buckets = bucketEntriesByPeriod(entries, 'week')
  assert.equal(buckets.length, 2)
  assert.equal(buckets[buckets.length - 1].key, 'no-date')
  assert.equal(buckets[buckets.length - 1].label, 'No date')
  assert.equal(buckets[buckets.length - 1].hours, 2)
})

test('fecha inválida cae en no-date (month)', () => {
  const buckets = bucketEntriesByPeriod([E(1, 'garbage', 5)], 'month')
  assert.equal(buckets.length, 1)
  assert.equal(buckets[0].key, 'no-date')
})

test('fechas overflow (mes 13, día 30 de feb) → no-date, no un mes corrido', () => {
  // '2026-13-01' NO debe rodar a 2027-01; '2026-02-30' NO debe rodar a marzo.
  const buckets = bucketEntriesByPeriod(
    [E(1, '2026-13-01', 2), E(2, '2026-02-30', 3)],
    'month',
  )
  assert.equal(buckets.length, 1)
  assert.equal(buckets[0].key, 'no-date')
  assert.equal(buckets[0].hours, 5)
})

test('week: fecha overflow → no-date (consistente con month)', () => {
  const buckets = bucketEntriesByPeriod([E(1, '2026-13-01', 2)], 'week')
  assert.equal(buckets[0].key, 'no-date')
})

test('mes cruzando año ordena bien (2027-01 antes de 2026-12)', () => {
  const entries = [E(1, '2026-12-20', 1), E(2, '2027-01-03', 2)]
  const buckets = bucketEntriesByPeriod(entries, 'month')
  assert.equal(buckets[0].key, '2027-01')
  assert.equal(buckets[1].key, '2026-12')
})

test('hours no numéricas no envenenan el total con NaN', () => {
  const buckets = bucketEntriesByPeriod([E(1, '2026-09-06', 'x'), E(2, '2026-09-06', 3)], 'total')
  assert.equal(buckets[0].hours, 3)
})

test('la suma total de horas se conserva entre modos', () => {
  const entries = [E(1, '2026-08-15', 1), E(2, '2026-09-06', 2), E(3, null, 4)]
  const sum = (bs) => bs.reduce((s, b) => s + b.hours, 0)
  assert.equal(sum(bucketEntriesByPeriod(entries, 'total')), 7)
  assert.equal(sum(bucketEntriesByPeriod(entries, 'month')), 7)
  assert.equal(sum(bucketEntriesByPeriod(entries, 'week')), 7)
})
