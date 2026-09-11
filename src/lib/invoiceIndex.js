/**
 * Índice entry→factura (módulo puro). Una hora está facturada si aparece en el
 * `entryIds` de alguna factura. Lo usan Billing, Entries y Client Summary para el
 * mismo criterio (antes cada página lo rearmaba inline; ver CLAUDE.md, reutilizar
 * lógica en servicios).
 *
 * @param {Array<{ entryIds?: Array<string|number> }>} invoices
 * @returns {Map<string, object>} entryId (String) → la factura que la cubre.
 */
export function invoiceByEntryId(invoices = []) {
  const map = new Map()
  for (const invoice of invoices ?? []) {
    for (const entryId of invoice.entryIds ?? []) map.set(String(entryId), invoice)
  }
  return map
}
