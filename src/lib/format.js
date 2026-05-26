// Utilidades de formato para fechas y horas.

const MONTHS_ES = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
]

/**
 * Formatea una fecha ISO (YYYY-MM-DD) como "04 may 2026".
 * Se parsea a mano para evitar corrimientos por zona horaria.
 * @param {string} iso
 * @returns {string}
 */
export function formatDate(iso = '') {
  const [year, month, day] = iso.split('-').map(Number)
  if (!year || !month || !day) return iso
  return `${String(day).padStart(2, '0')} ${MONTHS_ES[month - 1]} ${year}`
}

/**
 * Formatea horas siempre con un decimal (6 -> "6.0", 6.5 -> "6.5").
 * @param {number} hours
 * @returns {string}
 */
export function formatHours(hours) {
  return Number(hours || 0).toFixed(1)
}
