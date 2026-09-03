// Utilidades de formato para fechas y horas.

const MONTHS_EN = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/**
 * Formatea una fecha ISO (YYYY-MM-DD) como "04 May 2026".
 * Se parsea a mano para evitar corrimientos por zona horaria.
 * @param {string} iso
 * @returns {string}
 */
export function formatDate(iso = '') {
  if (!iso) return ''
  const [year, month, day] = iso.split('-').map(Number)
  if (!year || !month || !day) return iso
  return `${String(day).padStart(2, '0')} ${MONTHS_EN[month - 1]} ${year}`
}

/**
 * Formatea horas siempre con un decimal (6 -> "6.0", 6.5 -> "6.5").
 * @param {number} hours
 * @returns {string}
 */
export function formatHours(hours) {
  return Number(hours || 0).toFixed(1)
}

/**
 * Formato amigable para "última actualización":
 *   - < 1 min        → "hace instantes"
 *   - < 60 min       → "hace 7 min"
 *   - mismo día      → "14:23"
 *   - < 24 h         → "hace 5 h"
 *   - más viejo      → "04 may 2026"
 * @param {string} iso  timestamp ISO
 * @returns {?string}
 */
export function formatRelativeTime(iso) {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null

  const diffMin = Math.floor((Date.now() - then) / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin} min ago`

  const date = new Date(iso)
  const sameDay = new Date().toDateString() === date.toDateString()
  if (sameDay) {
    return date.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
  }
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours} h ago`
  return formatDate(iso.slice(0, 10))
}

/**
 * Domingo (UTC) que inicia la semana (domingo–sábado) de una fecha, o null si la
 * fecha no es válida. sundayWeek y sundayWeekYear parten de acá para no duplicar
 * el parseo ni el corrimiento al domingo (si se toca la aritmética, en un lugar).
 * @param {string} iso
 * @returns {?Date}
 */
function weekStartSunday(iso = '') {
  const [year, month, day] = iso.split('-').map(Number)
  if (!year || !month || !day) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  // Retroceder al domingo de su semana (getUTCDay: dom=0 … sáb=6).
  date.setUTCDate(date.getUTCDate() - date.getUTCDay())
  return date
}

/**
 * Número de semana (1..54) con semanas de DOMINGO a SÁBADO. Se numera por el
 * DOMINGO que inicia la semana (fórmula tipo Excel WEEKNUM(,1) aplicada a ese
 * domingo), así una semana física que cruza el fin de año NO se parte en dos
 * números: queda del lado del año de su domingo. Se parsea en UTC para evitar
 * corrimientos por zona horaria.
 *
 * Para semanas enteras dentro del año coincide con Excel WEEKNUM(fecha, 1). NO
 * coincide en el borde de año: si el 1-ene no cae en domingo, la semana que lo
 * contiene tiene su domingo en diciembre y queda como última semana del año
 * anterior (Excel la llamaría W1 del año nuevo). Se prioriza mantener la semana
 * física entera para facturar. El resto del año es inequívoco.
 * @param {string} iso
 * @returns {?number}
 */
export function sundayWeek(iso = '') {
  const sunday = weekStartSunday(iso)
  if (!sunday) return null
  const jan1 = new Date(Date.UTC(sunday.getUTCFullYear(), 0, 1))
  const dayOfYear = Math.round((sunday.getTime() - jan1.getTime()) / 86400000) + 1
  return Math.floor((dayOfYear - 1 + jan1.getUTCDay()) / 7) + 1
}

/**
 * Domingo (YYYY-MM-DD, UTC) que inicia la semana domingo–sábado de una fecha, o
 * null si la fecha no es válida. Es la fecha que fija la unidad facturable
 * (invoices.week_start). Reusa weekStartSunday para no duplicar la aritmética.
 * @param {string} iso
 * @returns {?string}
 */
export function weekStartISO(iso = '') {
  const sunday = weekStartSunday(iso)
  return sunday ? sunday.toISOString().slice(0, 10) : null
}

/**
 * Año de la semana domingo–sábado (el año del domingo que la inicia). Va junto a
 * sundayWeek para no fusionar la misma semana de años distintos (p. ej. W32 de
 * 2025 y de 2026).
 * @param {string} iso
 * @returns {?number}
 */
export function sundayWeekYear(iso = '') {
  const sunday = weekStartSunday(iso)
  return sunday ? sunday.getUTCFullYear() : null
}

/**
 * Sábado (YYYY-MM-DD, UTC) que cierra la semana domingo–sábado de una fecha, o
 * null si la fecha no es válida. Es el domingo de inicio + 6 días. Lo usa el
 * navegador de semana para mostrar el rango completo "dom → sáb". Reusa
 * weekStartSunday para partir del mismo domingo que el resto de la aritmética.
 * @param {string} iso
 * @returns {?string}
 */
export function weekEndISO(iso = '') {
  const sunday = weekStartSunday(iso)
  if (!sunday) return null
  sunday.setUTCDate(sunday.getUTCDate() + 6)
  return sunday.toISOString().slice(0, 10)
}

/**
 * Desplaza una fecha N semanas (positivo = adelante, negativo = atrás) y la
 * devuelve como YYYY-MM-DD (UTC), o null si no es válida. Si `iso` es el domingo
 * que inicia una semana, el resultado es el domingo de la semana N pasos más
 * allá — es lo que usan las flechas ‹ › del navegador de semana. Se parsea en
 * UTC para no correrse por zona horaria.
 * @param {string} iso
 * @param {number} weeks
 * @returns {?string}
 */
export function shiftWeekISO(iso = '', weeks = 0) {
  const [year, month, day] = iso.split('-').map(Number)
  if (!year || !month || !day) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + weeks * 7)
  return date.toISOString().slice(0, 10)
}

/**
 * Fecha ISO (YYYY-MM-DD) formateada como "MM-DD-YYYY" (08-23-2026), el formato
 * del rango del navegador de semana. Cadena vacía si la fecha no es válida.
 * @param {string} iso
 * @returns {string}
 */
export function formatUsDate(iso = '') {
  // Guard explícito de null/vacío: el default `iso = ''` sólo cubre undefined, y
  // esta función recibe el resultado de weekEndISO(), que devuelve null si la
  // fecha es inválida. Sin esto, null.split(...) rompería el render en vez de
  // devolver '' como promete el contrato.
  if (!iso) return ''
  const [year, month, day] = iso.split('-').map(Number)
  if (!year || !month || !day) return ''
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}-${year}`
}

/**
 * Semana formateada para la grilla: "W23" (o "—" si no hay fecha válida). Semanas
 * de domingo a sábado (ver sundayWeek).
 * @param {string} iso
 * @returns {string}
 */
export function formatWeek(iso = '') {
  const week = sundayWeek(iso)
  return week ? `W${week}` : '—'
}

/**
 * Fecha + hora compacta para el historial de sync: "04 may · 14:23".
 * @param {string} iso
 * @returns {string}
 */
export function formatDateTime(iso = '') {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const day = formatDate(iso.slice(0, 10))
  const time = date.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
  return `${day} · ${time}`
}

/**
 * Período de una factura como etiqueta de semana(s). Una factura puede cubrir una o
 * VARIAS semanas del mismo cliente+proyecto (feature multi-semana, migración 0044):
 *   - una sola semana (`weekEnd` null o igual a `weekStart`) → "WEEK 33 · 2026".
 *   - un rango → "WEEK 33 – 35 · 2026". Sólo si el rango es NO contiguo (o sea, las
 *     semanas realmente facturadas `weekCount` son MENOS que las que abarca el span)
 *     se agrega "(N weeks)" para aclarar que faltan semanas del medio. En un rango
 *     contiguo el "WEEK a – b" ya dice cuántas son, así que no se agrega ruido.
 *     Cruce de año (raro): "WEEK a · Ya – WEEK b · Yb".
 * Ambos extremos son domingos que identifican la semana (ver sundayWeek). Cadena
 * vacía si no hay `weekStart` (o es inválido); si `weekEnd` es inválido, degrada a la
 * forma de una sola semana.
 * @param {?string} weekStart domingo ISO de la primera semana
 * @param {?string} [weekEnd] domingo ISO de la última (null = una sola semana)
 * @param {?number} [weekCount] cantidad de semanas realmente facturadas (opcional)
 * @returns {string}
 */
export function formatInvoicePeriod(weekStart, weekEnd = null, weekCount = null) {
  const wS = sundayWeek(weekStart ?? '')
  if (wS == null) return ''
  const yS = sundayWeekYear(weekStart)
  const single = () => `WEEK ${wS} · ${yS}`
  // weekEnd ausente, igual, o ANTERIOR a weekStart (dato invertido, defensivo) → una
  // sola semana. Comparación lexicográfica de 'YYYY-MM-DD' = cronológica.
  if (!weekEnd || weekEnd <= weekStart) return single()
  const wE = sundayWeek(weekEnd)
  if (wE == null) return single() // weekEnd malformado → degrada a semana única, no "WEEK 33 – null"
  const yE = sundayWeekYear(weekEnd)
  const range =
    yS === yE ? `WEEK ${wS} – ${wE} · ${yE}` : `WEEK ${wS} · ${yS} – WEEK ${wE} · ${yE}`
  // Semanas que abarca el span. El "(N weeks)" sólo aporta cuando faltan semanas del
  // medio (weekCount < span, o sea NO contiguo) — en contiguo el rango ya es inequívoco.
  // spanWeeks se deriva de los números de semana ya calculados (wE - wS + 1), no de un
  // segundo parseo de fechas; sólo es fiable dentro del mismo año, así que en un cruce
  // de año (raro) no se muestra el conteo.
  const spanWeeks = yS === yE ? wE - wS + 1 : null
  return weekCount && spanWeeks && weekCount > 1 && weekCount < spanWeeks
    ? `${range} (${weekCount} weeks)`
    : range
}

/**
 * Cantidad de semanas domingo–sábado DISTINTAS que abarca un conjunto de fechas (las
 * de las horas de una factura). Sirve para el "(N weeks)" del período: cuenta las
 * semanas realmente facturadas, no el ancho del span (que en selecciones no contiguas
 * sería mayor). Fechas vacías/inválidas se ignoran.
 * @param {Array<?string>} isoDates
 * @returns {number}
 */
export function distinctWeekCount(isoDates = []) {
  const weeks = new Set()
  for (const d of isoDates) {
    const ws = weekStartISO(d ?? '')
    if (ws) weeks.add(ws)
  }
  return weeks.size
}

/**
 * Nombre de archivo legible a partir de un path de Storage. Los paths
 * llevan un prefijo de timestamp para evitar colisiones (ver
 * uploadClientMsa/uploadSowFile) y a veces una carpeta demo/ — ambos se pelan
 * acá para mostrar solo el nombre real.
 * @param {?string} path
 * @returns {string}
 */
export function fileNameFromPath(path) {
  if (!path) return ''
  return path.split('/').pop().replace(/^\d+-/, '')
}
