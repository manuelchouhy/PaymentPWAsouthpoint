// ---------------------------------------------------------------------------
// ¿Está "congelada" una hora? Congelada = no se puede re-clasificar (cambiarle la
// allocation), porque ya está comprometida en algo de plata:
//   - FACTURADA: entró en una factura de proveedor (Billing → "Send to billing"), o
//   - PAGADA: cubierta por un pago al contractor (overage pagado, vía entry_ids).
// Nada más la congela. Antes de eso se re-clasifica libremente y Billing la sigue
// solo (se arma en vivo desde las horas).
//
// El hueco que corrige: hasta ahora sólo la factura congelaba, así que una hora de
// overage YA PAGADA quedaba reclasificable — se podía cambiar de categoría después
// de que la plata salió. Ahora el pago también congela.
//
// Módulo puro: recibe dos Sets de ids ya calculados por el llamador, así se prueba
// sin base ni UI.
// ---------------------------------------------------------------------------

/**
 * @param {{ id: string|number }} entry
 * @param {{ invoicedEntryIds?: Set<string>, paidEntryIds?: Set<string> }} opts
 *   invoicedEntryIds: ids de horas que están en alguna factura de proveedor.
 *   paidEntryIds: ids de horas cubiertas por algún pago (overage).
 * @returns {boolean}
 */
export function isEntryFrozen(entry, { invoicedEntryIds, paidEntryIds } = {}) {
  return entryFrozenReason(entry, { invoicedEntryIds, paidEntryIds }) !== null
}

/**
 * POR QUÉ está congelada una hora (para rotularlo con precisión en la UI): por
 * estar facturada o por estar pagada. 'invoiced' tiene precedencia sobre 'paid'
 * (en la práctica son allocations disjuntas, pero el orden hace la salida estable).
 * @param {{ id: string|number }} entry
 * @param {{ invoicedEntryIds?: Set<string>, paidEntryIds?: Set<string> }} opts
 * @returns {'invoiced' | 'paid' | null}
 */
export function entryFrozenReason(entry, { invoicedEntryIds, paidEntryIds } = {}) {
  if (!entry) return null
  const id = String(entry.id)
  if (invoicedEntryIds?.has(id)) return 'invoiced'
  if (paidEntryIds?.has(id)) return 'paid'
  return null
}
