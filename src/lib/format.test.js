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
  formatInvoicePeriod,
  distinctWeekCount,
  formatTaskLabel,
} from './format.js'

// Las semanas de facturación van de DOMINGO a SÁBADO (no ISO lunes–domingo).
// En agosto 2026: Aug 1 = sábado, Aug 2 = domingo, Aug 8 = sábado, Aug 9 = domingo.

test('el domingo abre una semana nueva; el sábado previo es otra', () => {
  assert.notEqual(sundayWeek('2026-08-09'), sundayWeek('2026-08-08'))
})

// --- Período de factura (rango de semanas, feature multi-semana) --------------
// 2026-08-09 = WEEK 33; 2026-08-23 = WEEK 35 (domingos, mismo año).

test('formatInvoicePeriod: una sola semana (weekEnd null) → "WEEK N · año"', () => {
  assert.equal(formatInvoicePeriod('2026-08-09', null), 'WEEK 33 · 2026')
})

test('formatInvoicePeriod: weekEnd igual a weekStart también es semana única', () => {
  assert.equal(formatInvoicePeriod('2026-08-09', '2026-08-09'), 'WEEK 33 · 2026')
})

test('formatInvoicePeriod: rango (mismo año) → "WEEK a – b · año"', () => {
  assert.equal(formatInvoicePeriod('2026-08-09', '2026-08-23'), 'WEEK 33 – 35 · 2026')
})

test('formatInvoicePeriod: rango NO contiguo (weekCount < span) → agrega "(N weeks)"', () => {
  // Span 33–35 = 3 semanas, pero sólo 2 facturadas (falta una del medio) → se aclara.
  assert.equal(formatInvoicePeriod('2026-08-09', '2026-08-23', 2), 'WEEK 33 – 35 · 2026 (2 weeks)')
})

test('formatInvoicePeriod: rango CONTIGUO (weekCount === span) → sin "(N weeks)" (sería ruido)', () => {
  // Span 33–34 = 2 semanas, 2 facturadas: el rango ya lo dice, no se agrega el conteo.
  assert.equal(formatInvoicePeriod('2026-08-09', '2026-08-16', 2), 'WEEK 33 – 34 · 2026')
})

test('formatInvoicePeriod: weekEnd malformado → degrada a semana única (no "WEEK 33 – null")', () => {
  assert.equal(formatInvoicePeriod('2026-08-09', 'no-es-fecha'), 'WEEK 33 · 2026')
})

test('formatInvoicePeriod: rango invertido (weekEnd < weekStart) → semana única (defensivo)', () => {
  assert.equal(formatInvoicePeriod('2026-08-23', '2026-08-09'), 'WEEK 35 · 2026')
})

test('formatInvoicePeriod: sin weekStart → cadena vacía', () => {
  assert.equal(formatInvoicePeriod('', null), '')
  assert.equal(formatInvoicePeriod(null, '2026-08-23'), '')
})

test('distinctWeekCount: cuenta semanas domingo–sábado DISTINTAS entre fechas de horas', () => {
  // 08-12 y 08-10 caen en la semana del 08-09; 08-19 en la del 08-16 → 2 semanas.
  assert.equal(distinctWeekCount(['2026-08-12', '2026-08-10', '2026-08-19']), 2)
  // Fechas inválidas/vacías no cuentan.
  assert.equal(distinctWeekCount(['2026-08-12', '', null]), 1)
  assert.equal(distinctWeekCount([]), 0)
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

// --- Rótulo de task (id · nombre) para las filas de hora -----------------------

test('formatTaskLabel: con id y nombre → "id · nombre"', () => {
  assert.equal(formatTaskLabel('Login design', '123'), '123 · Login design')
})

test('formatTaskLabel: sin id (taskNumber vacío) → sólo el nombre', () => {
  assert.equal(formatTaskLabel('Login design', ''), 'Login design')
  assert.equal(formatTaskLabel('Login design', null), 'Login design')
  assert.equal(formatTaskLabel('Login design', undefined), 'Login design')
})

test('formatTaskLabel: sin nombre pero con id → sólo el id', () => {
  assert.equal(formatTaskLabel('', '123'), '123')
  assert.equal(formatTaskLabel(null, '123'), '123')
})

test('formatTaskLabel: sin id ni nombre → cadena vacía', () => {
  assert.equal(formatTaskLabel('', ''), '')
  assert.equal(formatTaskLabel(null, undefined), '')
})

test('formatTaskLabel: taskNumber numérico devuelve string (contrato @returns string)', () => {
  const soloId = formatTaskLabel('', 123)
  assert.equal(soloId, '123')
  assert.equal(typeof soloId, 'string')
  assert.equal(formatTaskLabel('Login design', 123), '123 · Login design')
})
