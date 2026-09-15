import { weekStartISO, weekEndISO, formatUsDate, formatMonth } from './format.js'

/**
 * Agrupado puro de las horas de un pago invoice-less en buckets de PERÍODO, para que el
 * picker "Hours to pay" de Payments permita pagar el TOTAL (como siempre), un MES o una
 * SEMANA de una sola vez (en vez de tildar hora por hora).
 *
 * Es presentacional/derivado: no decide qué se paga (eso lo sigue haciendo la selección
 * de ids en la página), sólo ORGANIZA las horas en buckets y calcula sus totales para que
 * el picker pueda ofrecer un "seleccionar todo el bucket".
 *
 * Modos:
 *   - 'total' → un único bucket con todas las horas (label 'All pending'). Es el
 *     comportamiento actual del picker.
 *   - 'month' → un bucket por mes calendario (clave 'YYYY-MM'), label "Sep 2026".
 *   - 'week'  → un bucket por semana física domingo–sábado (clave = domingo YYYY-MM-DD),
 *     label "MM-DD-YYYY to MM-DD-YYYY" (mismo rango que el WeekNavigator).
 *
 * Orden: buckets por clave DESCENDENTE (más reciente primero, como las filas ya pagadas).
 * Las horas dentro de cada bucket conservan el orden de entrada. Las horas sin fecha
 * válida NO se pierden: caen en un bucket propio 'no-date' (label 'No date') que va
 * SIEMPRE último. En modo 'total' todas van a un solo bucket sin importar la fecha.
 *
 * @param {Array<{id:(string|number), date?:?string, hours?:number}>} entries
 * @param {'total'|'month'|'week'} [mode='total']
 * @returns {Array<{key:string, label:string, entries:object[], entryIds:string[], hours:number}>}
 */
/**
 * Suma defensiva de horas de una lista de entries: `Number(x) || 0` para que una hora
 * mal tipada aporte 0 en vez de envenenar el total con NaN. Exportada para que el picker
 * de pagos calcule sus totales (seleccionadas, pendientes por bucket) con el MISMO
 * criterio que los buckets, sin duplicar la reducción.
 * @param {Array<{hours?:number}>} entries
 * @returns {number}
 */
export function sumHours(entries = []) {
  return entries.reduce((sum, e) => sum + (Number(e?.hours) || 0), 0)
}

export function bucketEntriesByPeriod(entries = [], mode = 'total') {
  // 'total' (y cualquier modo desconocido, defensivo) → un solo bucket con todo.
  if (mode !== 'month' && mode !== 'week') {
    if (entries.length === 0) return []
    return [makeBucket('all', 'All pending', entries)]
  }

  const NO_DATE = 'no-date'
  // Map en orden de inserción; después se ordena por clave. Cada bucket junta sus horas.
  const groups = new Map()
  for (const entry of entries) {
    const key = keyFor(entry.date, mode)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(entry)
  }

  const buckets = []
  for (const [key, bucketEntries] of groups) {
    buckets.push(makeBucket(key, labelFor(key, mode), bucketEntries))
  }

  // Orden: 'no-date' siempre último; el resto por clave descendente. Las claves
  // ('YYYY-MM' o 'YYYY-MM-DD') ordenan cronológicamente como strings.
  buckets.sort((a, b) => {
    if (a.key === NO_DATE) return 1
    if (b.key === NO_DATE) return -1
    return b.key.localeCompare(a.key)
  })
  return buckets
}

// ¿`date` es una fecha calendario REAL en formato 'YYYY-MM-DD'? Se valida por
// round-trip en UTC para RECHAZAR overflows que Date.UTC normalizaría en silencio
// ('2026-13-01' → 2027, '2026-02-30' → marzo): esos no deben caer en un mes/semana
// equivocado, van a 'no-date'. Así month y week tratan la fecha inválida igual.
function isValidISODate(date) {
  if (typeof date !== 'string') return false
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

// Clave de bucket de una fecha según el modo. Fecha inválida/ausente → 'no-date'.
function keyFor(date, mode) {
  if (!isValidISODate(date)) return 'no-date'
  // month: 'YYYY-MM' (la fecha ya está validada, no hay overflow que corra el mes).
  if (mode === 'month') return date.slice(0, 7)
  // week: el domingo que inicia la semana (fecha válida → weekStartISO no es null).
  return weekStartISO(date)
}

// Label legible de un bucket según su clave y modo.
function labelFor(key, mode) {
  if (key === 'no-date') return 'No date'
  if (mode === 'month') return formatMonth(key)
  // week: rango físico "MM-DD-YYYY to MM-DD-YYYY" (key es el domingo).
  return `${formatUsDate(key)} to ${formatUsDate(weekEndISO(key))}`
}

// Arma un bucket con sus ids (string) y el total de horas. `Number(...) || 0` para no
// envenenar el total con NaN si alguna hora viene mal tipada.
function makeBucket(key, label, bucketEntries) {
  return {
    key,
    label,
    entries: bucketEntries,
    entryIds: bucketEntries.map((e) => String(e.id)),
    hours: sumHours(bucketEntries),
  }
}
