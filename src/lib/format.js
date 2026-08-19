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
 * Jueves (UTC) de la semana ISO a la que pertenece una fecha, o null si la fecha
 * no es válida. isoWeek e isoWeekYear parten de acá para no duplicar el parseo y
 * el corrimiento al jueves (si se toca la aritmética, se toca en un solo lugar).
 * @param {string} iso
 * @returns {?Date}
 */
function isoThursday(iso = '') {
  const [year, month, day] = iso.split('-').map(Number)
  if (!year || !month || !day) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  // Llevar la fecha al jueves de su semana (lun=0 … dom=6).
  const dayNum = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - dayNum + 3)
  return date
}

/**
 * Número de semana ISO-8601 (1..53) a partir de una fecha ISO YYYY-MM-DD.
 * Las semanas arrancan en lunes y la semana 1 es la que contiene el primer
 * jueves del año. Se parsea en UTC para evitar corrimientos por zona horaria.
 * @param {string} iso
 * @returns {?number}
 */
export function isoWeek(iso = '') {
  const date = isoThursday(iso)
  if (!date) return null

  // Jueves de la semana 1 = jueves más cercano al 4 de enero.
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3)

  const msPerWeek = 7 * 24 * 60 * 60 * 1000
  return 1 + Math.round((date.getTime() - firstThursday.getTime()) / msPerWeek)
}

/**
 * Año ISO-8601 de la semana a la que pertenece una fecha (el año del jueves de
 * esa semana). NO siempre coincide con el año calendario: el 2026-01-01 puede
 * caer en la semana 53 de 2025. Se necesita junto a isoWeek para no fusionar la
 * misma semana de años distintos (p. ej. W32 de 2025 y de 2026).
 * @param {string} iso
 * @returns {?number}
 */
export function isoWeekYear(iso = '') {
  const date = isoThursday(iso)
  return date ? date.getUTCFullYear() : null
}

/**
 * Semana ISO formateada para la grilla: "W23" (o "—" si no hay fecha válida).
 * @param {string} iso
 * @returns {string}
 */
export function formatWeek(iso = '') {
  const week = isoWeek(iso)
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
