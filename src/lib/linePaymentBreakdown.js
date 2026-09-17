import { lookupById } from './invoiceCompletion.js'

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
 * Las horas por entry se calculan igual que `invoiceCompletion` (misma `lookupById` + fallback al
 * PROMEDIO de la línea cuando un entry cubierto no está en el snapshot), para que la suma de los
 * pagos cuadre con `paidHours`/`hours` de la línea y un pago real nunca muestre "0 h".
 *
 * @param {{ entryIds?: Array<string|number>, hours?: number }} contractor  la línea (invoice_contractor).
 * @param {Array<{ id?:any, entryIds?:Array<string|number>, supplierInvoiceNumber?:?string,
 *   paymentDate?:?string, createdAt?:?string }>} payments  pagos que cubren la línea (el caller pasa
 *   el set ya filtrado — O(pagos de la línea)); igual se interseca de forma defensiva.
 * @param {Map<string,number>|Record<string,number>} [hoursByEntryId]  entry_id → horas.
 * @returns {Array<{ id:any, supplierInvoiceNumber:?string, paymentDate:?string, createdAt:?string,
 *   hours:number }>}  un ítem por pago que toca la línea, ordenado por fecha (desempate por createdAt).
 */
export function linePaymentBreakdown(contractor, payments, hoursByEntryId) {
  const lineIdList = [...new Set((contractor?.entryIds ?? []).map(String))]
  if (lineIdList.length === 0) return []
  const lineIds = new Set(lineIdList)
  const lineHours = Number(contractor?.hours) || 0
  // Promedio por entry de la línea: fallback cuando un entry cubierto no está en el snapshot
  // (mismo criterio que invoiceCompletion, para no subestimar ni mostrar 0 h en un pago real).
  const avgPerEntry = lineIdList.length ? lineHours / lineIdList.length : 0
  const hoursOf = (id) => {
    if (hoursByEntryId == null) return avgPerEntry
    const n = Number(lookupById(hoursByEntryId, id))
    return Number.isFinite(n) ? n : avgPerEntry
  }
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
      hours: coveredHere.reduce((s, id) => s + hoursOf(id), 0),
    })
  }
  rows.sort(
    (a, b) =>
      (a.paymentDate || '').localeCompare(b.paymentDate || '') ||
      (a.createdAt || '').localeCompare(b.createdAt || ''),
  )
  return rows
}
