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
 *
 * `payments` puede ser la lista COMPLETA de pagos del sistema, no hace falta pre-filtrar
 * a esta factura: los entry_ids son únicos por hora (una hora pertenece a UNA factura),
 * así que un pago de otra factura nunca cubre los entry_ids de ésta. Pasar sólo los de
 * la factura también es válido (mismo resultado). Esa unicidad la GARANTIZA la base
 * (migración 0039: entry_ids sin solapamiento entre facturas/pagos), no este módulo.
 *
 * ACOPLAMIENTO con la RPC de status (04c): esta derivación es sólo para MOSTRAR y para
 * decidir a quién ofrecer pago; el `Paid` real lo escribe la RPC register_contractor_payment.
 * Las dos deben coincidir en descartar las filas invoice_contractors sin entry_ids (ver
 * el filtro abajo): lo más seguro es un CHECK en la base que impida crear una fila con
 * entry_ids vacío, así el caso glitch no existe y UI y DB nunca divergen. Además,
 * invoice_contractors.hours es por construcción la suma de las horas de sus entry_ids
 * (lo arma buildGroupedInvoicePayload rechazando entries sin horas válidas), así que
 * `hours` y `entry_ids` no divergen: una fila sin entry_ids tiene 0 horas reales.
 */

import { paidEntryIdsFrom } from './paymentsGrouping.js'

/**
 * @param {Array<{contractor:string, entryIds:Array<string|number>, hours:number}>} contractors  invoice_contractors de la factura
 * @param {Array<{entryIds:Array<string|number>}>} payments  pagos (por contractor); puede ser la lista completa
 * @returns {{
 *   contractors: Array<{contractor:string, entryIds:Array, hours:number, paid:boolean}>,
 *   paidCount:number, totalCount:number, totalHours:number, paidHours:number,
 *   status:'Invoiced'|'partial'|'Paid',
 * }}
 */
export function invoiceCompletion(contractors, payments) {
  const paidIds = paidEntryIdsFrom(payments)
  // Sólo filas facturables reales: con al menos un entry_id. Una fila sin entry_ids es
  // un dato anómalo (el builder invoiceContractors.js nunca la crea) y se DESCARTA: no
  // aporta horas y, si contara, una sola fila glitch dejaría la factura en 'partial'
  // para siempre, sin poder llegar nunca a 'Paid' aunque todo el trabajo real esté pago.
  const rows = (contractors ?? [])
    .filter((c) => (c?.entryIds ?? []).length > 0)
    .map((c) => {
      const entryIds = c.entryIds
      // Pagado = todas sus horas cubiertas por algún pago.
      const paid = entryIds.every((id) => paidIds.has(String(id)))
      return { contractor: c.contractor, entryIds, hours: Number(c.hours) || 0, paid }
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
