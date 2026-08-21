import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sundayWeek, sundayWeekYear, formatWeek } from './format.js'

// Las semanas de facturación van de DOMINGO a SÁBADO (no ISO lunes–domingo).
// En agosto 2026: Aug 1 = sábado, Aug 2 = domingo, Aug 8 = sábado, Aug 9 = domingo.

test('el domingo abre una semana nueva; el sábado previo es otra', () => {
  assert.notEqual(sundayWeek('2026-08-09'), sundayWeek('2026-08-08'))
})

test('de domingo a sábado caen en la misma semana', () => {
  const week = sundayWeek('2026-08-09') // domingo
  for (const d of ['2026-08-09', '2026-08-10', '2026-08-13', '2026-08-15']) {
    assert.equal(sundayWeek(d), week, `${d} debería estar en la misma semana`)
  }
  // El domingo siguiente ya es otra semana.
  assert.notEqual(sundayWeek('2026-08-16'), week)
})

test('numeración tipo Excel WEEKNUM(,1): semana 1 contiene el 1 de enero', () => {
  assert.equal(sundayWeek('2026-08-09'), 33) // domingo Aug 9 2026
  assert.equal(sundayWeek('2026-08-02'), 32) // domingo Aug 2 2026
  assert.equal(formatWeek('2026-08-14'), 'W33') // viernes → semana del Aug 9
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
