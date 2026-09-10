/**
 * Métricas de los cuadros de Billing, en HORAS. Módulo puro (sin React ni red):
 * dado el conjunto de horas ya filtrado por la barra de filtros, devuelve los
 * agregados que muestran los cuadros. El cuadro #2 (seleccionadas + consumed /
 * budget) NO se arma acá: su `consumed` es del proyecto completo (todas las semanas,
 * para comparar contra el budget), no el subconjunto que dejan los filtros de la
 * grilla — se calcula en la página junto con el budget del proyecto único.
 *
 * @param {object} args
 * @param {Array<{id:string|number, hours:number, status:string, allocation?:string|null}>} args.billToClient
 *   Horas del scope con allocation bill_to_client (misma lista `filtered` de la grilla).
 * @param {Array<{id:string|number, hours:number, status:string, allocation?:string|null}>} args.allAllocations
 *   Horas del scope de CUALQUIER allocation (misma lista `filteredAllAllocations`).
 * @param {{has:(id:string)=>boolean}} args.invoicedIds  colección con `.has(String(id))`
 *   de las horas ya facturadas (Set o el Map invoiceByEntryId sirven).
 * @param {Set<string>} [args.paidIds]  ids (string) de las horas overage ya pagadas al
 *   contractor (Payments): se excluyen del KPI Overage para que coincida con la tab
 *   de Overage (que muestra sólo lo pendiente de pago).
 * @returns {{pendingToBill:number, pendingCount:number, invoiced:number,
 *   unallocated:number, overage:number}}
 */
export function billingKpis({
  billToClient = [],
  allAllocations = [],
  invoicedIds = new Set(),
  paidIds = new Set(),
}) {
  const isApproved = (e) => e?.status === 'Approved'
  const isInvoiced = (e) => invoicedIds.has(String(e?.id))
  const isPaid = (e) => paidIds.has(String(e?.id))
  const h = (e) => Number(e?.hours) || 0

  // Pending to bill: bill_to_client aprobadas y SIN facturar (lo que está por entrar
  // a factura). overage/sp_internal tienen su propia sección aparte.
  let pendingToBill = 0
  let pendingCount = 0
  for (const entry of billToClient) {
    if (!isApproved(entry)) continue
    if (!isInvoiced(entry)) {
      pendingToBill += h(entry)
      pendingCount += 1
    }
  }

  // Invoiced: cualquier hora ya facturada del scope (sin filtrar por allocation ni
  // status — las facturas viejas son pre-triage y sus horas tienen allocation null).
  // Sin allocation y Overage cuentan sólo lo aprobado y NO facturado (las facturadas
  // ya están congeladas): mismo criterio para las dos, tratando igual "lo facturado".
  let invoiced = 0
  let unallocated = 0
  let overage = 0
  for (const entry of allAllocations) {
    if (isInvoiced(entry)) {
      invoiced += h(entry)
      continue
    }
    if (!isApproved(entry)) continue
    if (!entry?.allocation) unallocated += h(entry)
    // Overage excluye también las ya pagadas al contractor, para coincidir con la tab
    // de Overage (que lista sólo lo pendiente de pago).
    else if (entry.allocation === 'overage' && !isPaid(entry)) overage += h(entry)
  }

  return { pendingToBill, pendingCount, invoiced, unallocated, overage }
}
