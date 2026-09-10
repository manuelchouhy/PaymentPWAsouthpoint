/**
 * Estado de pago de una hora (entry) según el set de horas ya pagadas.
 * 'paid' si su id está en `paidEntryIds` (derivado de los payments con
 * paidEntryIdsFrom), 'pending' si no. El id se compara como string porque
 * paidEntryIds guarda strings y entry.id puede ser number o string.
 * @param {{id?: string|number}} entry
 * @param {Set<string>} paidEntryIds
 * @returns {'paid'|'pending'}
 */
export function entryPaymentStatus(entry, paidEntryIds) {
  return paidEntryIds?.has(String(entry?.id)) ? 'paid' : 'pending'
}
