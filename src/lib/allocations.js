// Mapa único de allocation → etiqueta + clase de badge, compartido por Entries y
// Billing (drawer de detalle). Antes vivía duplicado en ambas páginas y podía
// divergir en silencio al cambiar una categoría.
//
// 'unknown' es la categoría X (allocation real, CHECK 0034): una hora que no
// encaja en las otras tres. Distinta de null (= sin clasificar / sin triagear).
export const ALLOCATION_LABELS = {
  bill_to_client: { label: 'bill to client', cls: 'badge--alloc-bill' },
  overage: { label: 'overage', cls: 'badge--alloc-overage' },
  sp_internal: { label: 'SP internal', cls: 'badge--alloc-internal' },
  unknown: { label: 'X', cls: 'badge--alloc-unknown' },
}

/**
 * Separa un conjunto de horas recién clasificadas según si YA son facturables o
 * no. Billing sólo muestra horas con `status === 'Approved'`; el resto (Pending
 * de aprobación en Zoho, o Rejected) no entra a la grilla hasta aprobarse, y el
 * sync reescribe el status desde Zoho en cada corrida. Se usa para que el aviso
 * de Apply en Entries sea honesto —"N entraron a Billing, M quedan fuera hasta
 * aprobarse"— en vez de afirmar que todo lo clasificado "already in Billing".
 *
 * @param {Array<{status?: string, hours?: number|string}>} entries
 * @returns {{ approvedCount: number, approvedHours: number, notApprovedCount: number, notApprovedHours: number }}
 */
export function splitApprovalReadiness(entries = []) {
  let approvedCount = 0
  let approvedHours = 0
  let notApprovedCount = 0
  let notApprovedHours = 0
  for (const entry of entries ?? []) {
    const hours = Number(entry?.hours) || 0
    if (entry?.status === 'Approved') {
      approvedCount++
      approvedHours += hours
    } else {
      notApprovedCount++
      notApprovedHours += hours
    }
  }
  return { approvedCount, approvedHours, notApprovedCount, notApprovedHours }
}
