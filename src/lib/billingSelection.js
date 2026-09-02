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
  // Toda fila debe tener contractor: una fila sin `user` se caería del payload
  // agrupado (contractorsFromSelection la ignora) pero sus horas contarían en los
  // totales mostrados → mismatch. Se bloquea la emisión.
  if (rows.some((r) => (r?.user ?? '') === '')) return false
  return weekStartFromSelection(rows) !== null
}

/**
 * Por qué NO se puede emitir (para el aviso de la UI), o null si se puede. Cubre
 * TODOS los casos en que canBillSelection es false con algo seleccionado, así el
 * botón deshabilitado siempre tiene una explicación. Orden de precedencia: cruza
 * cliente, cruza proyecto, sin cliente, sin proyecto, sin contractor, sin fecha
 * (semana no resoluble), cruza semana. Con la selección vacía devuelve null.
 * @returns {'multi-client'|'multi-project'|'no-client'|'no-project'|'no-contractor'|'multi-week'|'no-week'|null}
 */
export function billBlockReason(selectedRows) {
  const rows = selectedRows ?? []
  if (!rows.some((r) => (r.entries ?? []).length > 0)) return null
  const { clients, projects } = selectionScope(rows)
  if (clients.size > 1) return 'multi-client'
  if (projects.size > 1) return 'multi-project'
  if ([...clients][0] === '') return 'no-client'
  if ([...projects][0] === '') return 'no-project'
  if (rows.some((r) => (r?.user ?? '') === '')) return 'no-contractor'
  const weeks = selectionWeekStarts(rows)
  // Sin fecha resoluble tiene precedencia sobre multi-week: si alguna hora no tiene
  // fecha, el problema es esa hora (no "cruza semanas"), aunque el resto sí resuelva.
  if (weeks.has('')) return 'no-week'
  if (weeks.size > 1) return 'multi-week'
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
    // Las horas de la entry se pasan CRUDAS al payload: así el guard de horas
    // inválidas del builder (invoiceContractors.normalizeEntries, que rechaza null)
    // sigue vivo por la ruta real de la UI. Para el total MOSTRADO se coerciona
    // (Number||0), misma fuente (las entries) que el builder, sin diverger.
    for (const e of r.entries ?? []) {
      c.entries.push({ id: e.id, hours: e.hours })
      c.hours += Number(e.hours) || 0
    }
  }
  return [...byName.values()].sort(
    (a, b) => b.hours - a.hours || a.contractor.localeCompare(b.contractor, 'es'),
  )
}

/**
 * Horas pendientes de cada contractor que NO entran en esta factura (aviso C11).
 * La factura es UN cliente + UN proyecto + UNA semana, así que el pendiente se mide
 * en ESA misma unidad (no en todo el cliente): si no, reportaría como "omitidas"
 * horas de otros proyectos/semanas que NO se pueden facturar acá.
 * @param {Map<string,number>} pendingByUnitUser clave `${client}||${project}||${weekStart}||${user}`
 * @returns {Array<{contractor:string, remaining:number}>}
 */
export function remainingHoursByContractor(selectedRows, pendingByUnitUser) {
  const { clients, projects } = selectionScope(selectedRows)
  if (clients.size !== 1 || projects.size !== 1) return []
  const client = [...clients][0]
  const project = [...projects][0]
  const weekStart = weekStartFromSelection(selectedRows)
  if (client === '' || project === '' || weekStart == null) return []
  const out = []
  for (const c of contractorsFromSelection(selectedRows)) {
    const pending = pendingByUnitUser?.get(`${client}||${project}||${weekStart}||${c.contractor}`) ?? 0
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

/**
 * Proyectos de `projects` que corresponden a la selección para el AVISO DE CONTRATO
 * del modal agrupado. La unión se hace, en orden de preferencia:
 *
 *  1. Por `zohoProjectId` (clave del sync). Es el join CORRECTO: identifica LA fila
 *     de proyecto exacta que se está facturando, sobrevive a renames (el id no
 *     cambia) y a homónimos (dos proyectos con el mismo nombre tienen ids distintos).
 *     Un match por id NO se filtra por cliente: es el contrato del proyecto real de
 *     las horas, así que se muestra tal cual. Ver findProjectForEntry (entryClient.js),
 *     que ya une hora→proyecto por este mismo id.
 *  2. Sólo para horas SIN id (legacy/pre-sync), fallback por NOMBRE de proyecto. Ahí
 *     el nombre es ambiguo, así que se filtra por cliente MAESTRO (via `resolveClient`,
 *     el mismo resolver de la grilla) para no avisar con el contrato de otro cliente
 *     ni ocultar un aviso en homónimos. Regla de descarte: sólo se saltea si el
 *     proyecto resuelve a un cliente maestro DISTINTO y no vacío; si resuelve a null
 *     (grupo sin reclamar / sin grupo) se INCLUYE a propósito (fail-safe: mejor avisar
 *     de más que ocultar un vencimiento). Sin `client` o sin `resolveClient`, el
 *     fallback sólo matchea por nombre, preservando ese criterio fail-safe.
 *
 * @param {Array<object>} projects  lista cruda de proyectos (api.projects.list)
 * @param {Iterable<{zohoProjectId?: ?(string|number), project?: ?string}>} selectedEntries  horas de la selección
 * @param {?string} client  cliente maestro de la grilla
 * @param {?((project: object) => { client: string|null })} resolveClient  resolver maestro
 * @returns {Array<object>}
 */
export function projectsForContractWarnings(projects, selectedEntries, client, resolveClient) {
  const ids = new Set() // zohoProjectId de la selección (join preferido)
  const namesNoId = new Set() // nombres de horas SIN id (fallback)
  for (const e of selectedEntries ?? []) {
    if (e?.zohoProjectId) ids.add(String(e.zohoProjectId))
    else if (e?.project) namesNoId.add(e.project)
  }
  const out = []
  for (const p of projects ?? []) {
    // 1. Match exacto por id: es la fila facturada, sin filtro de cliente.
    if (p?.zohoProjectId && ids.has(String(p.zohoProjectId))) {
      out.push(p)
      continue
    }
    // 2. Fallback por nombre (sólo horas legacy sin id), filtrado por cliente maestro.
    if (namesNoId.has(p?.projectName)) {
      if (client && typeof resolveClient === 'function') {
        const master = resolveClient(p)?.client ?? null
        if (master && master !== client) continue // sólo descarta si resuelve a OTRO
      }
      out.push(p)
    }
  }
  return out
}
