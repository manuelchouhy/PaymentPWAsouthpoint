/**
 * Desglose de los PAGOS que cubren una línea de contractor (para el detalle read-only de una
 * factura Paid/parcial — slice 05, ADR 0005). Reconstruye cada pago parcial por su cobertura de
 * `entry_ids`: cuántas horas de ESTA línea cubre, con su supplier# y fecha.
 *
 * Con el modelo de pago parcial (0052) todo pago bajo factura lleva sus `entry_ids` (el
 * subconjunto pagado), así que una línea pagada en varios parciales devuelve varias filas, y una
 * pagada de una sola vez ("Total") devuelve una fila con la línea completa. Los pagos LEGACY
 * (0040, previos a 0052) tienen `entry_ids` NULL/vacío → no aportan filas (no se puede
 * reconstruir su cobertura por hora).
 *
 * @param {{ entryIds?: Array<string|number> }} contractor  la línea (invoice_contractor).
 * @param {Array<{ id?:any, entryIds?:Array<string|number>, supplierInvoiceNumber?:?string,
 *   paymentDate?:?string, createdAt?:?string }>} payments  todos los pagos conocidos.
 * @param {Map<string, number>} [hoursByEntryId]  entry_id → horas (para sumar las horas cubiertas).
 * @returns {Array<{ id:any, supplierInvoiceNumber:?string, paymentDate:?string, createdAt:?string,
 *   hours:number, entryCount:number }>}  un ítem por pago que toca la línea, ordenado por fecha
 *   (desempate por createdAt).
 */
export function linePaymentBreakdown(contractor, payments, hoursByEntryId) {
  const lineIds = new Set((contractor?.entryIds ?? []).map(String))
  if (lineIds.size === 0) return []
  const hours = hoursByEntryId ?? new Map()
  const rows = []
  for (const p of payments ?? []) {
    // Horas de ESTA línea que cubre el pago = intersección de sus entry_ids con la línea.
    const coveredHere = [...new Set((p?.entryIds ?? []).map(String))].filter((id) => lineIds.has(id))
    if (coveredHere.length === 0) continue
    rows.push({
      id: p.id,
      supplierInvoiceNumber: p.supplierInvoiceNumber ?? null,
      paymentDate: p.paymentDate ?? null,
      createdAt: p.createdAt ?? null,
      hours: coveredHere.reduce((s, id) => s + (Number(hours.get(id)) || 0), 0),
      entryCount: coveredHere.length,
    })
  }
  rows.sort(
    (a, b) =>
      (a.paymentDate || '').localeCompare(b.paymentDate || '') ||
      (a.createdAt || '').localeCompare(b.createdAt || ''),
  )
  return rows
}
