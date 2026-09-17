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
 * Horas por pago: se suman las horas reales de las entries cubiertas (misma `lookupById` que
 * invoiceCompletion, con fallback al promedio de la línea si una entry no está en el snapshot) y
 * luego se RECONCILIAN con el total autoritativo de la línea (`contractor.paidHours`, ya
 * calculado por invoiceCompletion y que la grilla muestra): si el snapshot driftea (una entry
 * editada tras facturar, o fuera del cap), las filas se escalan proporcionalmente para que su
 * suma cuadre EXACTAMENTE con lo que muestra la fila. Sin drift no hay escalado (números reales).
 * Así el desglose no puede contradecir a la línea por construcción.
 *
 * @param {{ entryIds?: Array<string|number>, hours?: number, paidHours?: number }} contractor
 * @param {Array<{ id?:any, entryIds?:Array<string|number>, supplierInvoiceNumber?:?string,
 *   paymentDate?:?string, createdAt?:?string }>} payments  pagos que cubren la línea (el caller pasa
 *   el set ya filtrado — O(pagos de la línea)); igual se interseca de forma defensiva.
 * @param {Map<string,number>|Record<string,number>} [hoursByEntryId]  entry_id → horas.
 * @returns {Array<{ id:any, supplierInvoiceNumber:?string, paymentDate:?string, createdAt:?string,
 *   hours:number }>}  un ítem por pago que toca la línea, ordenado por fecha (desempate por createdAt).
 */
export function linePaymentBreakdown(contractor, payments, hoursByEntryId) {
  const lineIds = new Set((contractor?.entryIds ?? []).map(String))
  if (lineIds.size === 0) return []
  const lineHours = Number(contractor?.hours) || 0
  // Promedio por entry de la línea: fallback cuando un entry cubierto no está en el snapshot
  // (mismo criterio que invoiceCompletion, para no mostrar 0 h en un pago real).
  const avgPerEntry = lineHours / lineIds.size
  const hoursOf = (id) => {
    if (hoursByEntryId == null) return avgPerEntry
    const n = Number(lookupById(hoursByEntryId, id))
    return Number.isFinite(n) ? n : avgPerEntry
  }
  const rows = []
  let totalRaw = 0
  for (const p of payments ?? []) {
    // Horas de ESTA línea que cubre el pago = intersección de sus entry_ids con la línea.
    const coveredHere = [...new Set((p?.entryIds ?? []).map(String))].filter((id) => lineIds.has(id))
    if (coveredHere.length === 0) continue
    const raw = coveredHere.reduce((s, id) => s + hoursOf(id), 0)
    totalRaw += raw
    rows.push({
      id: p.id,
      supplierInvoiceNumber: p.supplierInvoiceNumber ?? null,
      paymentDate: p.paymentDate ?? null,
      createdAt: p.createdAt ?? null,
      hours: raw,
    })
  }
  // Reconcilia con el total autoritativo de la línea (invoiceCompletion.paidHours): escala las
  // filas para que su suma sea exactamente lo que muestra la fila. Sin drift, authoritative ==
  // totalRaw → sin cambios. Sólo si el caller pasó un paidHours válido y hay horas para repartir.
  const authoritative = Number(contractor?.paidHours)
  if (rows.length && Number.isFinite(authoritative) && totalRaw > 0 && authoritative !== totalRaw) {
    const factor = authoritative / totalRaw
    for (const r of rows) r.hours *= factor
  }
  rows.sort(
    (a, b) =>
      (a.paymentDate || '').localeCompare(b.paymentDate || '') ||
      (a.createdAt || '').localeCompare(b.createdAt || ''),
  )
  return rows
}
