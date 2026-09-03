import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  sundayWeek,
  sundayWeekYear,
  formatWeek,
  weekStartISO,
  weekEndISO,
  shiftWeekISO,
  formatUsDate,
} from './format.js'

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

// --- Helpers del navegador de semana -----------------------------------------
// La semana del domingo 2026-08-23 va de 2026-08-23 (dom) a 2026-08-29 (sáb) y es
// la W35 · 2026 (coincide con el mockup del navegador).

test('weekEndISO: el sábado que cierra la semana (domingo + 6)', () => {
  assert.equal(weekEndISO('2026-08-23'), '2026-08-29') // desde el domingo
  assert.equal(weekEndISO('2026-08-26'), '2026-08-29') // desde un día intermedio
  assert.equal(weekEndISO('2026-08-29'), '2026-08-29') // desde el propio sábado
  assert.equal(weekEndISO(''), null)
})

test('shiftWeekISO: ‹ › desplazan de a semanas exactas', () => {
  assert.equal(shiftWeekISO('2026-08-23', 1), '2026-08-30') // semana siguiente
  assert.equal(shiftWeekISO('2026-08-23', -1), '2026-08-16') // semana anterior
  assert.equal(shiftWeekISO('2026-08-23', 0), '2026-08-23')
  // Cruza el fin de mes/año sin corrimiento de zona horaria.
  assert.equal(shiftWeekISO('2025-12-28', 1), '2026-01-04')
  assert.equal(shiftWeekISO('nope', 1), null)
})

test('formatUsDate: MM-DD-YYYY como el rango del navegador', () => {
  assert.equal(formatUsDate('2026-08-23'), '08-23-2026')
  assert.equal(formatUsDate('2026-01-05'), '01-05-2026')
  assert.equal(formatUsDate(''), '')
  // null (lo que devuelve weekEndISO ante una fecha inválida) no debe romper:
  // el navegador hace formatUsDate(weekEndISO(value)) al renderizar el rango.
  assert.equal(formatUsDate(null), '')
})

test('el número de semana del mockup: WEEK - 35 · 2026', () => {
  assert.equal(sundayWeek('2026-08-23'), 35)
  assert.equal(sundayWeekYear('2026-08-23'), 2026)
})
