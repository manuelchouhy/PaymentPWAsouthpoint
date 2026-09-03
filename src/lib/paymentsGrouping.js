/**
 * Agrupaciones puras del módulo Payments para pagos "invoice-less": overage y
 * sp_internal. Estas horas se le pagan directo al contractor SIN factura al
 * cliente. Módulo sin side-effects (no toca Supabase) para poder testearlo con
 * `node --test`, igual que billingGrouping.js.
 */

// Ids de horas ya cubiertas por algún pago (por su entryIds). Vive acá —módulo
// puro, sin import de Supabase— para poder usarse bajo `node --test`;
// paymentsData.js lo re-exporta para el resto de la app (una sola fuente, sin
// duplicar la lógica de coerción a String).
export function paidEntryIdsFrom(payments) {
  const set = new Set()
  for (const p of payments ?? []) {
    // `p?.entryIds`: un elemento null/undefined en el array no debe romper (los
    // llamadores pasan listas crudas de la base / mezcladas).
    for (const id of p?.entryIds ?? []) set.add(String(id))
  }
  return set
}

const INVOICELESS_ALLOCATIONS = ['overage', 'sp_internal']

/**
 * Horas de un allocation invoice-less (overage / sp_internal) pendientes de
 * pago, agrupadas por contractor. Criterio: allocation coincide, aprobadas en
 * Zoho (status 'Approved') y NO cubiertas ya por un pago (paidEntryIds) ni por
 * una factura de proveedor (invoices.entryIds) — así una misma hora no se paga
 * dos veces. Overage y sp_internal comparten exactamente esta lógica: sólo
 * cambia el allocation que se filtra.
 * @param {Array<object>} entries
 * @param {Array<object>} payments
 * @param {Array<object>} invoices
 * @param {'overage'|'sp_internal'} allocation
 * @returns {Array<{user:string, hours:number, entryIds:Array, entries:Array}>}
 *   por horas desc, luego nombre. `entries` es el desglose por hora (para pagar
 *   sólo algunas).
 */
export function pendingToPayByContractor(entries = [], payments = [], invoices = [], allocation) {
  // Guard explícito: sin esto, un allocation faltante/erróneo no matchea ninguna
  // hora y la función devuelve [] en silencio — la UI mostraría "nada pendiente"
  // en vez de fallar, y el bug pasaría desapercibido.
  if (!INVOICELESS_ALLOCATIONS.includes(allocation)) {
    throw new Error(
      `pendingToPayByContractor: allocation must be one of ${INVOICELESS_ALLOCATIONS.join('/')}, got ${allocation}`,
    )
  }
  const paid = paidEntryIdsFrom(payments)
  const invoiced = new Set(
    (invoices ?? []).flatMap((inv) => (inv.entryIds ?? []).map(String)),
  )
  const byUser = new Map()
  for (const entry of entries ?? []) {
    if (!entry || entry.allocation !== allocation || entry.status !== 'Approved') continue
    if (paid.has(String(entry.id)) || invoiced.has(String(entry.id))) continue
    const group = byUser.get(entry.user) ?? { user: entry.user, hours: 0, entryIds: [], entries: [] }
    group.hours += Number(entry.hours) || 0
    group.entryIds.push(entry.id)
    group.entries.push({
      id: entry.id,
      hours: Number(entry.hours) || 0,
      project: entry.project,
      task: entry.task,
      date: entry.date,
    })
    byUser.set(entry.user, group)
  }
  return [...byUser.values()].sort(
    (a, b) => b.hours - a.hours || (a.user || '').localeCompare(b.user || '', 'es'),
  )
}

/**
 * Pagos invoice-less YA hechos (read-only), particionados por allocation. Un
 * pago sin factura (invoiceId null) que cubre entryIds es de overage o de
 * sp_internal; el allocation se resuelve mirando las horas cubiertas (todas
 * comparten allocation porque el pendiente se agrupa por allocation, y una vez
 * pagadas quedan congeladas). Un pago cuyas horas no aparezcan como sp_internal
 * en `entries` cae en overage (catch-all): esto asume que `entries` trae TODAS
 * las horas (así es hoy: timeEntries.list() no pagina). Si en el futuro se
 * acotara/paginara, un pago de sp_internal cuyas horas no estén cargadas se
 * mostraría bajo Overage — en ese caso conviene persistir el allocation en el
 * propio pago. Cada bucket va más reciente arriba.
 * @param {Array<object>} payments
 * @param {Array<object>} entries
 * @returns {{overage:Array<object>, spInternal:Array<object>}}
 */
export function invoicelessPaidRows(payments = [], entries = []) {
  // Una sola pasada por entries para ambos lookups (allocation y horas por id).
  const allocById = new Map()
  const hoursById = new Map()
  for (const e of entries ?? []) {
    allocById.set(String(e.id), e.allocation)
    hoursById.set(String(e.id), Number(e.hours) || 0)
  }
  // Modelo en HORAS (slice 05): sin amountPaid/currency. El pago invoice-less se
  // muestra por sus horas (suma de las entries cubiertas) y su fecha.
  const toRow = (p) => ({
    id: p.id,
    user: p.userName,
    hours: (p.entryIds ?? []).reduce((sum, id) => sum + (hoursById.get(String(id)) || 0), 0),
    entryCount: p.entryIds?.length ?? 0,
    paymentDate: p.paymentDate,
  })
  const byDateDesc = (a, b) => (b.paymentDate || '').localeCompare(a.paymentDate || '')
  const overage = []
  const spInternal = []
  for (const p of payments ?? []) {
    if (p.invoiceId || (p.entryIds?.length ?? 0) === 0) continue
    const isSpInternal = (p.entryIds ?? []).some((id) => allocById.get(String(id)) === 'sp_internal')
    ;(isSpInternal ? spInternal : overage).push(toRow(p))
  }
  overage.sort(byDateDesc)
  spInternal.sort(byDateDesc)
  return { overage, spInternal }
}
