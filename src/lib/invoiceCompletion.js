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
 * Un contractor se considera PAGADO cuando TODAS sus horas (entry_ids) están cubiertas por
 * pagos — se reutiliza `paidEntryIdsFrom` (por entry_ids), la misma base del anti doble-pago
 * (trigger 0037). Con pago parcial por período (ADR 0005), la cobertura puede ser de un
 * subconjunto: la línea queda PARCIALMENTE paga (ver `paidHours`/`unpaidEntryIds`). El link
 * `paymentId` de la fila es el pago POR FACTURA legacy (entry_ids NULL en el pago, no
 * detectable por cobertura) y cuenta como línea entera paga SÓLO cuando no hay ninguna
 * cobertura por entry_ids; si conviven, manda la cobertura (paymentId vestigial en parcial).
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
 * Lee un valor por id de un Map u objeto plano, probando la clave String y la numérica. La
 * clave numérica sólo se usa si round-trip‑ea exacto (`String(Number(id)) === String(id)`): así
 * un id grande (> 2^53, escala Zoho) que Number() redondearía no matchea la clave de OTRO id
 * por pérdida de precisión. Única fuente de esta normalización (la usan hoursOf y
 * contractorsLookup), para que no existan dos variantes que divergen.
 */
export function lookupById(source, id) {
  if (source == null) return undefined
  if (source instanceof Map) {
    const byStr = source.get(String(id))
    if (byStr !== undefined) return byStr
    const num = Number(id)
    return Number.isFinite(num) && String(num) === String(id) ? source.get(num) : undefined
  }
  // Objeto plano: obj[5] y obj['5'] son la misma clave, así que alcanza con String.
  return source[String(id)]
}

/**
 * @param {Array<{contractor:string, entryIds:Array<string|number>, hours:number}>} contractors  invoice_contractors de la factura
 * @param {Array<{entryIds:Array<string|number>}>} payments  pagos (por contractor); puede ser la lista completa
 * @param {Map<string|number,number>|Record<string|number,number>} [hoursByEntryId]  horas por entry_id
 *   (Map u objeto; claves numéricas o string). Con él, `paidHours` por línea es la suma EXACTA de
 *   las horas de los entry_ids cubiertos (pago parcial por período); sin él se prorratea.
 * @returns {{
 *   contractors: Array<{contractor:string, entryIds:Array, hours:number, paid:boolean,
 *     paidHours:number, unpaidEntryIds:string[]}>,
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
    const n = Number(lookupById(hoursByEntryId, id))
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
      // Una sola pasada: partir los entry_ids ÚNICOS en cubiertos / pendientes. Se deduplica
      // (`seen`) para no doble-contar un id repetido en la fila (defensivo; no debería pasar).
      const coveredByEntries = []
      const uncoveredByEntries = []
      const seen = new Set()
      for (const rawId of entryIds) {
        const id = String(rawId)
        if (seen.has(id)) continue
        seen.add(id)
        if (paidIds.has(id)) coveredByEntries.push(id)
        else uncoveredByEntries.push(id)
      }
      const uniqueCount = seen.size
      // paymentId es el pago POR FACTURA legacy (entry_ids NULL en el pago, así que la cobertura
      // por hora NO lo detecta). Cuenta como "línea entera paga" SÓLO cuando no hay ninguna
      // cobertura por entry_ids: con el modelo nuevo (ADR 0005) el pago parcial cubre entry_ids
      // y "paid" se deriva de la cobertura; si conviven, manda la cobertura para no ocultar las
      // horas que todavía faltan (aunque un pago parcial dejara paymentId seteado).
      const legacyWholeLine = c.paymentId != null && coveredByEntries.length === 0
      const paid = legacyWholeLine || uncoveredByEntries.length === 0
      const unpaidEntryIds = paid ? [] : uncoveredByEntries
      // Horas cubiertas: el total si la línea está paga; exactas por entry si hay lookup (capadas
      // a lineHours por si las horas por entry no suman exacto al total); si no, prorrateo uniforme.
      let paidHours
      const avgPerEntry = uniqueCount ? lineHours / uniqueCount : 0
      if (paid) paidHours = lineHours
      else if (hoursByEntryId != null) {
        // Exacto por entry; un entry cubierto AUSENTE del lookup cae al promedio de la línea
        // (no a 0), para no subestimar cuando el map viene de otro snapshot. Capado a lineHours.
        const sum = coveredByEntries.reduce((s, id) => s + (hoursOf(id) ?? avgPerEntry), 0)
        paidHours = Math.min(sum, lineHours)
      } else {
        paidHours = avgPerEntry * coveredByEntries.length
      }
      // Se PRESERVAN los campos originales (id, supplierInvoiceNumber, paymentId,
      // paymentDate) además de `paid`/`paidHours`/`unpaidEntryIds`, para que la UI pueda
      // pagar/mostrar cada fila sin re-buscar la fila invoice_contractors original. `entryIds`
      // se emite DEDUPLICADO (string) para que sea consistente con `unpaidEntryIds` (evita que
      // un flujo de pago que itere entryIds mande un id repetido, y que anyCovered compare
      // longitudes de sets distintos).
      return { ...c, entryIds: [...seen], hours: lineHours, paid, paidHours, unpaidEntryIds }
    })

  const totalCount = rows.length
  const paidCount = rows.filter((r) => r.paid).length
  const totalHours = rows.reduce((sum, r) => sum + r.hours, 0)
  // Agregado partial-aware: suma las horas cubiertas de cada línea (incluye parciales), no
  // sólo las de las líneas 100% pagas.
  const paidHours = rows.reduce((sum, r) => sum + (Number(r.paidHours) || 0), 0)

  // Parcial-aware: hay cobertura si a alguna línea le faltan MENOS entry_ids de los que tiene
  // (una línea 100% paga cae acá). Como `entryIds` y `unpaidEntryIds` ahora están ambos
  // deduplicados, la comparación es precisa aun con `hours` 0/null (no depende de paidHours).
  // Nada cubierto → Invoiced; todas las líneas pagas → Paid; en el medio → partial.
  const anyCovered = rows.some((r) => r.unpaidEntryIds.length < r.entryIds.length)
  let status = 'Invoiced'
  if (totalCount > 0 && paidCount === totalCount) status = 'Paid'
  else if (anyCovered) status = 'partial'

  return { contractors: rows, paidCount, totalCount, totalHours, paidHours, status }
}

// Getter contractors-de-una-factura que acepta tanto un Map como un objeto plano (según cómo
// la capa de datos entregue invoice_contractors por factura). Reusa lookupById (String/Number
// con guarda de precisión) para no perder el match ni colisionar por ids grandes.
function contractorsLookup(contractorsByInvoice) {
  return (id) => lookupById(contractorsByInvoice, id) ?? []
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
