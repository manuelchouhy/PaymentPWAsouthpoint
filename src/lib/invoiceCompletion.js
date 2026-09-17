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
 * Un contractor se considera PAGADO cuando su fila tiene `paymentId` (lo setea la RPC
 * register_contractor_payment al pagar; el pago por factura lleva entry_ids NULL, así que
 * este link es la única señal en ese caso) O cuando TODAS sus horas (entry_ids) están
 * cubiertas por algún pago — se reutiliza `paidEntryIdsFrom` (por entry_ids), la misma
 * base del anti doble-pago (trigger 0037). El match por entry_ids no depende de la grafía
 * del contractor; el `paymentId` cubre el caso del pago por factura (sin entry_ids).
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
export function invoiceCompletion(contractors, payments, hoursByEntryId) {
  return completionFromPaidIds(contractors, paidEntryIdsFrom(payments), hoursByEntryId)
}

/**
 * Núcleo de `invoiceCompletion` con el set de entry_ids pagados YA computado. Separar
 * el armado del set (paidEntryIdsFrom, O(pagos)) del cálculo por factura permite
 * reusarlo entre muchas facturas sin re-escanear todos los pagos cada vez.
 * @param {Array<{contractor:string, entryIds:Array<string|number>, hours:number}>} contractors
 * @param {Set<string>} paidIds
 */
function completionFromPaidIds(contractors, paidIds, hoursByEntryId) {
  // Lookup de horas por entry_id (Map u objeto plano), opcional. Con él, paidHours por línea
  // es la suma EXACTA de las horas de los entry_ids cubiertos (pago parcial por período). Sin
  // él, se prorratea uniformemente sobre el total de la línea (aproximación cuando el caller
  // no tiene el desglose por hora, p. ej. payableInvoicesByContractor desde la capa de datos).
  const hoursOf = (id) => {
    if (hoursByEntryId == null) return null
    const v = hoursByEntryId instanceof Map ? hoursByEntryId.get(String(id)) : hoursByEntryId[String(id)]
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  // Sólo filas facturables reales: con al menos un entry_id. Una fila sin entry_ids es
  // un dato anómalo (el builder invoiceContractors.js nunca la crea) y se DESCARTA: no
  // aporta horas y, si contara, una sola fila glitch dejaría la factura en 'partial'
  // para siempre, sin poder llegar nunca a 'Paid' aunque todo el trabajo real esté pago.
  const rows = (contractors ?? [])
    .filter((c) => (c?.entryIds ?? []).length > 0)
    .map((c) => {
      const entryIds = c.entryIds
      const lineHours = Number(c.hours) || 0
      const covered = (id) => paidIds.has(String(id))
      // El link paymentId (pago POR FACTURA con entry_ids NULL) marca la línea entera como
      // paga: no hay cobertura por hora que mirar, así que TODAS sus horas cuentan como pagas.
      const wholeLinePaid = c.paymentId != null
      const coveredEntryIds = wholeLinePaid ? entryIds.map(String) : entryIds.filter(covered).map(String)
      const unpaidEntryIds = wholeLinePaid ? [] : entryIds.filter((id) => !covered(id)).map(String)
      // Pagado si: pago por factura (paymentId) O todas sus horas cubiertas por algún pago.
      const paid = wholeLinePaid || unpaidEntryIds.length === 0
      // Horas cubiertas: exactas si hay lookup por entry; si no, prorrateo uniforme (o el
      // total si la línea está entera paga, para no perder precisión en el caso común).
      let paidHours
      if (paid) paidHours = lineHours
      else if (hoursByEntryId != null) {
        paidHours = coveredEntryIds.reduce((s, id) => s + (hoursOf(id) ?? 0), 0)
      } else {
        paidHours = entryIds.length ? (lineHours * coveredEntryIds.length) / entryIds.length : 0
      }
      // Se PRESERVAN los campos originales (id, supplierInvoiceNumber, paymentId,
      // paymentDate) además de `paid`/`paidHours`/`unpaidEntryIds`, para que la UI pueda
      // pagar/mostrar cada fila sin re-buscar la fila invoice_contractors original.
      return { ...c, entryIds, hours: lineHours, paid, paidHours, unpaidEntryIds }
    })

  const totalCount = rows.length
  const paidCount = rows.filter((r) => r.paid).length
  const totalHours = rows.reduce((sum, r) => sum + r.hours, 0)
  // Agregado partial-aware: suma las horas cubiertas de cada línea (incluye parciales), no
  // sólo las de las líneas 100% pagas.
  const paidHours = rows.reduce((sum, r) => sum + (Number(r.paidHours) || 0), 0)

  // Cobertura parcial-aware: hay algo cubierto si alguna línea está paga o si a alguna le
  // faltan MENOS horas de las que tiene (cobertura parcial). Sin nada cubierto → Invoiced;
  // todo → Paid; en el medio → partial. Factura vacía (sin contractors) → Invoiced.
  const anyCovered = rows.some((r) => r.paid || r.unpaidEntryIds.length < r.entryIds.length)
  let status = 'Invoiced'
  if (totalCount > 0 && paidCount === totalCount) status = 'Paid'
  else if (anyCovered) status = 'partial'

  return { contractors: rows, paidCount, totalCount, totalHours, paidHours, status }
}

// Getter contractors-de-una-factura que acepta tanto un Map como un objeto plano
// (según cómo la capa de datos entregue invoice_contractors por factura). Prueba la
// clave cruda y su String, porque invoice.id puede venir number o string.
function contractorsLookup(contractorsByInvoice) {
  if (contractorsByInvoice instanceof Map) {
    // El Map lo arma la capa de datos y puede estar keyed por el id numérico de la
    // base o por su String. invoice.id también puede venir number o string, así que
    // se prueban las tres formas (cruda, String, Number) para no perder el match.
    return (id) => {
      const num = Number(id)
      // Sólo se prueba la clave numérica si el id round-trip‑ea exacto: así un id
      // string enorme (> 2^53) que Number() redondearía no matchea la clave de OTRA
      // factura por pérdida de precisión.
      const byNum =
        Number.isFinite(num) && String(num) === String(id) ? contractorsByInvoice.get(num) : undefined
      return contractorsByInvoice.get(id) ?? contractorsByInvoice.get(String(id)) ?? byNum ?? []
    }
  }
  // Objeto plano: sus claves ya son strings (obj[5] y obj['5'] son la misma), así que
  // alcanza con probar cruda y String.
  const obj = contractorsByInvoice ?? {}
  return (id) => obj[id] ?? obj[String(id)] ?? []
}

/**
 * Facturas PAGABLES agrupadas con sus contractors pendientes (04b). Para el módulo
 * Payments: cada factura `Invoiced` se expande a los contractors que todavía no se
 * pagaron, con el progreso (X de N) y las horas, componiendo `invoiceCompletion`.
 *
 * Sólo entran las facturas con status `Invoiced` (las `Paid` ya están cerradas) y que
 * tengan al menos un contractor pendiente: una factura `Invoiced` con TODOS sus
 * contractors ya pagos es un estado transitorio (la RPC aún no flipeó el status a
 * `Paid`) y no tiene nada que pagar, así que no aparece en la lista. Orden: la más
 * vieja primero (worklist por antigüedad; las sin fecha van al fondo, no como "más
 * vieja"), desempate por id numérico para orden estable.
 *
 * REQUISITO 04c: para que ese estado transitorio no se vuelva permanente, la RPC
 * register_contractor_payment debe flipear el status a `Paid` de forma ATÓMICA al
 * pagar al ÚLTIMO contractor (en la misma transacción). Si no, una factura con todo
 * pago quedaría `Invoiced` en la base y acá oculta (sin pendientes) para siempre.
 *
 * @param {Array<{id:string|number, status:string, invoiceDate?:string}>} invoices
 * @param {Map<string|number, Array>|Record<string, Array>} contractorsByInvoice  invoice_contractors por id de factura
 * @param {Array<{entryIds:Array<string|number>}>} payments  pagos (puede ser la lista completa)
 * @returns {Array<{invoice:object, contractors:Array, pending:Array, paidCount:number, totalCount:number, totalHours:number, paidHours:number, status:string}>}
 */
export function payableInvoicesByContractor(invoices, contractorsByInvoice, payments) {
  const lookup = contractorsLookup(contractorsByInvoice)
  const paidIds = paidEntryIdsFrom(payments) // una vez: se reusa entre todas las facturas
  const out = []
  for (const inv of invoices ?? []) {
    if (inv?.status !== 'Invoiced') continue
    const completion = completionFromPaidIds(lookup(inv.id), paidIds)
    const pending = completion.contractors.filter((c) => !c.paid)
    if (pending.length === 0) continue
    out.push({ invoice: inv, ...completion, pending })
  }
  return out.sort((a, b) => {
    // Sin fecha → centinela que ordena DESPUÉS de cualquier fecha ISO real, para caer
    // al fondo del worklist en vez de encabezarlo como si fuera la más vieja. Desempate
    // por id con orden numérico ('2' antes de '10'). Se compara lexicográficamente
    // asumiendo invoiceDate ISO zero-padded (YYYY-MM-DD), que es lo que devuelve la
    // columna date de Postgres; se coerciona a String para no romper si llegara un
    // Date/otro tipo (no ordenaría cronológico, pero no crashea la lista entera).
    const da = String(a.invoice.invoiceDate || '9999-12-31')
    const db = String(b.invoice.invoiceDate || '9999-12-31')
    return (
      da.localeCompare(db) ||
      String(a.invoice.id).localeCompare(String(b.invoice.id), undefined, { numeric: true })
    )
  })
}
