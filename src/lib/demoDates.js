/**
 * Fechas para los fixtures del modo demo (sin Supabase configurado).
 *
 * Las fechas de los mocks NO se hardcodean: varias pantallas miden contra la
 * fecha de hoy —Capacity promedia las últimas 4 semanas de uso, el estado de
 * un contrato sale de sus días restantes, el ritmo requerido de un SOW sale de
 * las semanas hasta period_end— así que una fecha fija deja de demostrar la
 * feature apenas pasa el tiempo. Los fixtures anteriores eran de abril/mayo de
 * 2026 y para agosto ya caían fuera de toda ventana: uso 0, capacidad 0,
 * demanda vacía.
 *
 * Se evalúan una vez, al cargar el módulo. Es suficiente: nadie deja una
 * sesión de demo abierta cruzando la medianoche esperando que los números se
 * recalculen solos.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Fecha ISO (YYYY-MM-DD) desplazada respecto de hoy.
 * @param {number} days  negativo = pasado, positivo = futuro
 * @returns {string}
 */
export function demoDate(days) {
  const d = new Date(Date.now() + days * MS_PER_DAY)
  // Componentes LOCALES, no toISOString(): daysRemaining() calcula "hoy" con
  // getFullYear/getMonth/getDate (hora local), así que un offset en UTC corre
  // las fechas un día en cualquier zona al oeste de Greenwich después de las
  // 21:00 — y un offset puesto justo en el borde de una banda de estado
  // (30/60/90 días) cambiaría de badge según la hora en que se abra el demo.
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/**
 * Timestamp ISO completo desplazado respecto de hoy, para campos created_at /
 * updated_at que se muestran con hora.
 * @param {number} days
 * @returns {string}
 */
export function demoTimestamp(days) {
  return new Date(Date.now() + days * MS_PER_DAY).toISOString()
}
