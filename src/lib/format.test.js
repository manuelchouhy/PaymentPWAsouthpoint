import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sundayWeek, sundayWeekYear, formatWeek, weekStartISO } from './format.js'

// Las semanas de facturación van de DOMINGO a SÁBADO (no ISO lunes–domingo).
// En agosto 2026: Aug 1 = sábado, Aug 2 = domingo, Aug 8 = sábado, Aug 9 = domingo.

test('el domingo abre una semana nueva; el sábado previo es otra', () => {
  assert.notEqual(sundayWeek('2026-08-09'), sundayWeek('2026-08-08'))
})

test('weekStartISO: el domingo de la semana dom–sáb de una fecha', () => {
  // Aug 9 (dom) → Aug 15 (sáb) es una semana; su domingo es 2026-08-09.
  assert.equal(weekStartISO('2026-08-12'), '2026-08-09')
  assert.equal(weekStartISO('2026-08-09'), '2026-08-09')
  assert.equal(weekStartISO('2026-08-15'), '2026-08-09')
  // El sábado previo (Aug 8) cae en la semana anterior.
  assert.equal(weekStartISO('2026-08-08'), '2026-08-02')
  assert.equal(weekStartISO(''), null)
})

test('de domingo a sábado caen en la misma semana', () => {
  const week = sundayWeek('2026-08-09') // domingo
  for (const d of ['2026-08-09', '2026-08-10', '2026-08-13', '2026-08-15']) {
    assert.equal(sundayWeek(d), week, `${d} debería estar en la misma semana`)
  }
  // El domingo siguiente ya es otra semana.
  assert.notEqual(sundayWeek('2026-08-16'), week)
})

test('numera por el domingo de la semana (Aug 2026 → W32/W33)', () => {
  assert.equal(sundayWeek('2026-08-09'), 33) // domingo Aug 9 2026
  assert.equal(sundayWeek('2026-08-02'), 32) // domingo Aug 2 2026
  assert.equal(formatWeek('2026-08-14'), 'W33') // viernes → semana del Aug 9
})

test('borde de año: la semana del 1-ene (no domingo) queda en el año anterior', () => {
  // 2026-01-01 es jueves → su semana arranca el domingo 2025-12-28.
  assert.equal(sundayWeekYear('2026-01-02'), 2025)
  // Se numera por ese domingo de diciembre (no como W1 de 2026, a diferencia
  // de Excel WEEKNUM), para no partir la semana física.
  assert.ok(sundayWeek('2026-01-02') >= 52)
})

test('el año de la semana es el del domingo que la inicia', () => {
  assert.equal(sundayWeekYear('2026-08-14'), 2026)
  assert.equal(sundayWeekYear('2025-08-15'), 2025)
})

test('fecha inválida → null / —', () => {
  assert.equal(sundayWeek(''), null)
  assert.equal(sundayWeekYear('nope'), null)
  assert.equal(formatWeek(''), '—')
})
