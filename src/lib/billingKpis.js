/**
 * Métricas de los cuadros de Billing, en HORAS. Módulo puro (sin React ni red):
 * dado el conjunto de horas ya filtrado por la barra de filtros, devuelve los
 * agregados que muestran los cuadros. El cuadro #2 (seleccionadas + consumed /
 * budget) se arma en la página con `consumed` de acá, `selectedHours` y el budget
 * del proyecto único; acá sólo vive la parte agregable/testeable.
 *
 * @param {object} args
 * @param {Array<{id:string|number, hours:number, status:string, allocation?:string|null}>} args.billToClient
 *   Horas del scope con allocation bill_to_client (misma lista `filtered` de la grilla).
 * @param {Array<{id:string|number, hours:number, status:string, allocation?:string|null}>} args.allAllocations
 *   Horas del scope de CUALQUIER allocation (misma lista `filteredAllAllocations`).
 * @param {Set<string>} args.invoicedIds  ids (string) de las horas ya facturadas.
 * @returns {{pendingToBill:number, pendingCount:number, invoiced:number,
 *   unallocated:number, overage:number, consumed:number}}
 */
export function billingKpis({ billToClient = [], allAllocations = [], invoicedIds = new Set() }) {
  const isApproved = (e) => e?.status === 'Approved'
  const isInvoiced = (e) => invoicedIds.has(String(e?.id))
  const h = (e) => Number(e?.hours) || 0

  // Pending to bill: bill_to_client aprobadas y SIN facturar (lo que está por entrar
  // a factura). Consumed: TODAS las bill_to_client aprobadas del scope (facturadas +
  // pendientes) = lo entregado; overage/sp_internal tienen su propia sección.
  let pendingToBill = 0
  let pendingCount = 0
  let consumed = 0
  for (const entry of billToClient) {
    if (!isApproved(entry)) continue
    consumed += h(entry)
    if (!isInvoiced(entry)) {
      pendingToBill += h(entry)
      pendingCount += 1
    }
  }

  // Invoiced: cualquier hora ya facturada del scope (sin filtrar por allocation ni
  // status — las facturas viejas son pre-triage y sus horas tienen allocation null).
  // Sin allocation: aprobadas, sin clasificar (allocation falsy) y sin facturar (las
  // facturadas ya están congeladas). Overage: aprobadas con allocation overage.
  let invoiced = 0
  let unallocated = 0
  let overage = 0
  for (const entry of allAllocations) {
    if (isInvoiced(entry)) invoiced += h(entry)
    if (!isApproved(entry)) continue
    if (!entry.allocation && !isInvoiced(entry)) unallocated += h(entry)
    else if (entry.allocation === 'overage') overage += h(entry)
  }

  return { pendingToBill, pendingCount, invoiced, unallocated, overage, consumed }
}
