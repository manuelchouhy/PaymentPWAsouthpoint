/**
 * Estado de completitud de una factura AGRUPADA multi-contractor, en HORAS
 * (slice 04, PRD billing-project-grouping). Una factura `Invoiced` agrupa a varios
 * contractors; a cada uno se le paga por separado en Payments (un pago por
 * contractor, bajo la misma factura). La factura pasa a `Paid` sólo cuando TODOS
 * sus contractors están pagados.
 *
 * Módulo puro (sin imports de Supabase) para testearlo con `node --test`, igual que
 * paymentsGrouping.js / invoiceContractors.js. La capa de datos y la UI lo consumen;
 * el estado real `Paid` lo decide la RPC en la base (esta derivación es para MOSTRAR
 * el progreso y decidir qué contractors ofrecer a pago, no para escribir el status).
 *
 * Un contractor se considera PAGADO cuando TODAS sus horas (entry_ids) están cubiertas
 * por algún pago — se reutiliza `paidEntryIdsFrom` (por entry_ids), la misma base del
 * anti doble-pago (trigger 0037). Se matchea por entry_ids, no por nombre: es lo que
 * congela la base y evita depender de la grafía del contractor.
 */

import { paidEntryIdsFrom } from './paymentsGrouping.js'

/**
 * @param {Array<{contractor:string, entryIds:Array<string|number>, hours:number}>} contractors  invoice_contractors de la factura
 * @param {Array<{entryIds:Array<string|number>}>} payments  pagos (por contractor)
 * @returns {{
 *   contractors: Array<{contractor:string, entryIds:Array, hours:number, paid:boolean}>,
 *   paidCount:number, totalCount:number, totalHours:number, paidHours:number,
 *   status:'Invoiced'|'partial'|'Paid',
 * }}
 */
export function invoiceCompletion(contractors, payments) {
  const paidIds = paidEntryIdsFrom(payments)
  const rows = (contractors ?? []).map((c) => {
    const entryIds = c?.entryIds ?? []
    // Pagado = tiene horas Y todas están cubiertas. Un contractor sin entry_ids
    // (dato anómalo) no puede estar "pagado": no hay nada que cubrir.
    const paid = entryIds.length > 0 && entryIds.every((id) => paidIds.has(String(id)))
    return { contractor: c?.contractor, entryIds, hours: Number(c?.hours) || 0, paid }
  })

  const totalCount = rows.length
  const paidCount = rows.filter((r) => r.paid).length
  const totalHours = rows.reduce((sum, r) => sum + r.hours, 0)
  const paidHours = rows.reduce((sum, r) => sum + (r.paid ? r.hours : 0), 0)

  // Sin contractors pagados → Invoiced; todos → Paid; en el medio → partial. Con la
  // factura vacía (sin contractors) queda Invoiced: no hay nada que completar.
  let status = 'Invoiced'
  if (totalCount > 0 && paidCount === totalCount) status = 'Paid'
  else if (paidCount > 0) status = 'partial'

  return { contractors: rows, paidCount, totalCount, totalHours, paidHours, status }
}
