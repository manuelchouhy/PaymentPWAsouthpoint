/**
 * Lógica pura de la selección para emitir una factura AGRUPADA multi-contractor
 * (slice 03). Una factura cubre UN cliente + UN proyecto y agrupa a varios
 * contractors. Sin side-effects (no toca Supabase ni React) para poder testearlo
 * con `node --test`, igual que billingGrouping.js / invoiceContractors.js.
 *
 * Las filas seleccionadas (`selectedRows`) son las de la grilla de Billing: cada
 * una es un log con { user, client, project, date, hours, entries:[{id,hours,date}] }.
 */

import { weekStartISO } from './format.js'

// Conjuntos de clientes y proyectos presentes en la selección. Los valores
// vacíos/ausentes NO se filtran: se cuentan como el valor '' para que una fila sin
// proyecto (bucket "—") sea un valor DISTINTO y no se mezcle en silencio con un
// proyecto real (ni deje pasar una selección sin proyecto). Se distinguen luego.
export function selectionScope(selectedRows) {
  const clients = new Set()
  const projects = new Set()
  for (const r of selectedRows ?? []) {
    clients.add(r?.client ?? '')
    projects.add(r?.project ?? '')
  }
  return { clients, projects }
}

// Domingos (ISO) que abren la(s) semana(s) de la selección. Un valor por semana
// distinta; '' si alguna hora no tiene fecha resoluble.
export function selectionWeekStarts(selectedRows) {
  const starts = new Set()
  for (const r of selectedRows ?? []) {
    for (const e of r.entries ?? []) {
      starts.add(weekStartISO(e.date ?? r.date ?? '') ?? '')
    }
  }
  return starts
}

/**
 * ¿La selección se puede emitir como UNA factura agrupada? La unidad facturable es
 * UN cliente + UN proyecto + UNA semana (dom→sáb); varios contractors permitidos.
 * Requiere que cliente y proyecto sean no vacíos (una hora sin proyecto no se
 * factura) y que todas las horas caigan en la misma semana.
 */
export function canBillSelection(selectedRows) {
  const rows = selectedRows ?? []
  const hasEntries = rows.some((r) => (r.entries ?? []).length > 0)
  const { clients, projects } = selectionScope(rows)
  if (!hasEntries || clients.size !== 1 || projects.size !== 1) return false
  if ([...clients][0] === '' || [...projects][0] === '') return false
  return weekStartFromSelection(rows) !== null
}

/**
 * Por qué NO se puede emitir (para el aviso de la UI), o null si se puede. Cubre
 * TODOS los casos en que canBillSelection es false con algo seleccionado, así el
 * botón deshabilitado siempre tiene una explicación. Orden de precedencia: cruza
 * cliente, cruza proyecto, sin proyecto, cruza semana, sin fecha (semana no
 * resoluble). Con la selección vacía devuelve null (no hay nada que avisar).
 * @returns {'multi-client'|'multi-project'|'no-project'|'multi-week'|'no-week'|null}
 */
export function billBlockReason(selectedRows) {
  const rows = selectedRows ?? []
  if (!rows.some((r) => (r.entries ?? []).length > 0)) return null
  const { clients, projects } = selectionScope(rows)
  if (clients.size > 1) return 'multi-client'
  if (projects.size > 1) return 'multi-project'
  if (projects.size === 1 && [...projects][0] === '') return 'no-project'
  const weeks = selectionWeekStarts(rows)
  if (weeks.size > 1) return 'multi-week'
  // Una sola "semana" pero es '' → alguna hora no tiene fecha resoluble.
  if (weeks.size === 1 && [...weeks][0] === '') return 'no-week'
  return null
}

/**
 * Agrupa las filas seleccionadas por contractor para createGroupedInvoice: una
 * entrada por contractor con sus entries ({id,hours}) y la suma de horas. Ordenado
 * por horas desc, desempate por nombre (mismo criterio visual que el resto).
 * @returns {Array<{contractor:string, entries:Array<{id:any,hours:number}>, hours:number}>}
 */
export function contractorsFromSelection(selectedRows) {
  const byName = new Map()
  for (const r of selectedRows ?? []) {
    const name = r?.user
    if (!name) continue
    if (!byName.has(name)) byName.set(name, { contractor: name, entries: [], hours: 0 })
    const c = byName.get(name)
    for (const e of r.entries ?? []) c.entries.push({ id: e.id, hours: Number(e.hours) || 0 })
    c.hours += Number(r.hours) || 0
  }
  return [...byName.values()].sort(
    (a, b) => b.hours - a.hours || a.contractor.localeCompare(b.contractor, 'es'),
  )
}

/**
 * Horas pendientes de cada contractor en el cliente de la selección que NO entran
 * en esta factura (aviso C11 recalculado por-contractor). Sólo con un cliente en la
 * selección (con varios, la resta cruzaría clientes y sería ambigua).
 * @param {Map<string,number>} pendingByClientProvider clave `${client}||${user}`
 * @returns {Array<{contractor:string, remaining:number}>}
 */
export function remainingHoursByContractor(selectedRows, pendingByClientProvider) {
  const { clients } = selectionScope(selectedRows)
  if (clients.size !== 1) return []
  const [client] = clients
  const out = []
  for (const c of contractorsFromSelection(selectedRows)) {
    const pending = pendingByClientProvider?.get(`${client}||${c.contractor}`) ?? 0
    const remaining = Math.max(0, pending - c.hours)
    if (remaining > 0) out.push({ contractor: c.contractor, remaining })
  }
  return out
}

/**
 * week_start (domingo ISO) de la selección: si todas las horas caen en la misma
 * semana domingo–sábado, esa; si la selección cruza semanas, null (el modelo tiene
 * un solo week_start y la unidad facturable es cliente+proyecto, no la semana).
 * @returns {?string}
 */
export function weekStartFromSelection(selectedRows) {
  const starts = selectionWeekStarts(selectedRows)
  if (starts.size !== 1) return null
  const [only] = starts
  return only === '' ? null : only
}
