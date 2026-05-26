// Color e iniciales de avatar derivados del nombre del usuario.
// Paleta vibrante para dark mode — un color por usuario para escanear
// rápido la regla de "un proveedor por vez".

const AVATAR_COLORS = [
  '#8B5CF6', // violet 500
  '#06B6D4', // cyan 500
  '#10B981', // emerald 500
  '#F59E0B', // amber 500
  '#EC4899', // pink 500
  '#3B82F6', // blue 500
  '#F43F5E', // rose 500
  '#84CC16', // lime 500
]

/**
 * Devuelve un color estable para un nombre dado.
 * @param {string} name
 * @returns {string} color hexadecimal
 */
export function avatarColor(name = '') {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

/**
 * Devuelve las iniciales (hasta dos letras) de un nombre.
 * @param {string} name
 * @returns {string}
 */
export function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0][0]
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (first + last).toUpperCase()
}
