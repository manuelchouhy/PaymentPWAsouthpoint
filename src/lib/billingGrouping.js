import { isoWeek, isoWeekYear } from './format.js'

// ---------------------------------------------------------------------------
// Agrupación de la tab "Bill to client": las horas facturables ordenadas POR
// CLIENTE (lo que se definió en el grill). De cada cliente cuelgan sus semanas
// ISO (la más reciente arriba) y de cada semana sus filas proveedor·proyecto·task.
//
// Sólo entran las horas realmente pendientes de facturar: allocation
// 'bill_to_client', status 'Approved' y que no estén ya en una factura
// (isInvoiced). El resto de allocations (overage, sp_internal, unknown) viven en
// otras tabs y no se tocan acá.
//
// Las horas que no resolvieron cliente van a un bucket "Sin cliente" (client ''),
// SIEMPRE arriba mientras tenga horas, agrupado por proyecto y con el motivo de
// no-resolución (clientReason: 'group-unclaimed' | 'no-group') para que se pueda
// explicar por qué quedó sin facturar. El resto de los clientes se ordena por
// horas pendientes desc.
// ---------------------------------------------------------------------------

const hoursOf = (entry) => Number(entry?.hours) || 0
const sumHours = (entries) => entries.reduce((total, entry) => total + hoursOf(entry), 0)
// El sufijo `||inv` separa las filas facturadas de las pendientes de la misma
// terna (para el filtro de estado C9). Sólo se agrega cuando la hora está
// facturada, así las keys de las filas pendientes (el caso por defecto) no cambian.
const rowKey = (entry) =>
  `${entry.user ?? ''}||${entry.project ?? ''}||${entry.task ?? ''}${entry._invoiced ? '||inv' : ''}`

/**
 * Filas proveedor·proyecto·task de una semana, combinando las horas de la misma
 * terna y ordenadas por horas desc (desempata por usuario).
 */
function groupRows(entries) {
  const byKey = new Map()
  for (const entry of entries) {
    const key = rowKey(entry)
    const row = byKey.get(key)
    if (row) {
      row.hours += hoursOf(entry)
      row.entries.push(entry)
    } else {
      byKey.set(key, {
        key,
        user: entry.user ?? '',
        project: entry.project ?? '',
        task: entry.task ?? '',
        // invoiced: la fila es de horas ya facturadas (read-only en la grilla). La
        // key separa facturadas de pendientes, así una fila es puramente una u otra.
        invoiced: Boolean(entry._invoiced),
        hours: hoursOf(entry),
        entries: [entry],
      })
    }
  }
  return [...byKey.values()].sort(
    (a, b) => b.hours - a.hours || a.user.localeCompare(b.user, 'es'),
  )
}

/**
 * Semanas ISO de un cliente, la más reciente arriba (por la fecha más nueva de la
 * semana). Cada semana trae sus filas y su total de horas. Las horas sin fecha
 * caen en una semana "—" que queda al fondo.
 *
 * La clave incluye el AÑO ISO, no sólo el número de semana: un cliente que paga
 * lento puede tener horas sin facturar en la W32 de 2025 y en la W32 de 2026, y
 * clavear sólo por número las fusionaría en una sola fila (una factura mezclando
 * entries con un año de diferencia). El id (`weekId`) es "año-semana"; la etiqueta
 * muestra "W32 · 2025" para que dos semanas homónimas de años distintos se
 * distingan a simple vista.
 */
function groupWeeks(entries) {
  const byWeek = new Map()
  for (const entry of entries) {
    const weekNum = isoWeek(entry.date ?? '')
    const weekYear = isoWeekYear(entry.date ?? '')
    const weekId = weekNum ? `${weekYear}-${weekNum}` : 'sin-fecha'
    const date = entry.date ?? ''
    const week = byWeek.get(weekId)
    if (week) {
      week.entries.push(entry)
      if (date > week.latestDate) week.latestDate = date
    } else {
      byWeek.set(weekId, {
        weekId,
        weekNum,
        weekYear,
        week: weekNum ? `W${weekNum} · ${weekYear}` : '—',
        latestDate: date,
        entries: [entry],
      })
    }
  }
  return [...byWeek.values()]
    .map((week) => ({
      weekId: week.weekId,
      week: week.week,
      weekNum: week.weekNum,
      weekYear: week.weekYear,
      latestDate: week.latestDate,
      hours: sumHours(week.entries),
      rows: groupRows(week.entries),
    }))
    .sort((a, b) => (b.latestDate || '').localeCompare(a.latestDate || ''))
}

/**
 * Proyectos del bucket "Sin cliente", cada uno con su motivo de no-resolución y
 * ordenados por horas desc. El motivo suele ser propiedad del proyecto (todas sus
 * horas comparten motivo), pero dos proyectos de Zoho homónimos pueden caer en el
 * mismo grupo por nombre con motivos distintos (uno 'no-group', otro
 * 'group-unclaimed'): en ese caso se deja el motivo en null (→ "Unresolved") en
 * vez de mostrar el del primero, que desviaría a quien intenta arreglar el grupo.
 */
function groupProjectsWithReason(entries) {
  const byProject = new Map()
  for (const entry of entries) {
    const project = entry.project ?? ''
    const reason = entry.clientReason ?? null
    const group = byProject.get(project)
    if (group) {
      group.entries.push(entry)
      if (group.reason !== reason) group.reason = null // motivos mixtos → sin motivo único
    } else {
      byProject.set(project, { project, reason, entries: [entry] })
    }
  }
  return [...byProject.values()]
    .map((group) => ({
      project: group.project,
      reason: group.reason,
      hours: sumHours(group.entries),
      entries: group.entries,
    }))
    .sort((a, b) => b.hours - a.hours || a.project.localeCompare(b.project, 'es'))
}

/**
 * Agrupa las horas facturables por cliente para la tab "Bill to client".
 *
 * @param {Array<object>} entries — entries ya con `client` y `clientReason` derivados.
 * @param {{ isInvoiced?: (entry: object) => boolean }} opts — isInvoiced marca las
 *   horas ya facturadas (se excluyen del pendiente).
 * @returns {Array<object>} clientes; "Sin cliente" (isUnassigned) primero, el
 *   resto por horas desc. Los asignados traen `weeks`; el bucket sin cliente trae
 *   `projects` (con motivo).
 */
export function groupBillToClient(
  entries = [],
  { isInvoiced = () => false, statusFilter = 'pending' } = {},
) {
  // statusFilter (C9): 'pending' (default, sólo sin facturar — la grilla facturable
  // de siempre), 'invoiced' (sólo facturadas, read-only) o 'all' (ambas). Cada hora
  // se taggea con _invoiced para separar filas y marcarlas en la UI.
  const billable = (entries ?? [])
    .filter(
      (entry) =>
        entry &&
        entry.allocation === 'bill_to_client' &&
        entry.status === 'Approved' &&
        (statusFilter === 'all' ||
          (statusFilter === 'invoiced' ? isInvoiced(entry) : !isInvoiced(entry))),
    )
    .map((entry) => ({ ...entry, _invoiced: isInvoiced(entry) }))

  const byClient = new Map()
  for (const entry of billable) {
    const client = entry.client || ''
    if (!byClient.has(client)) byClient.set(client, [])
    byClient.get(client).push(entry)
  }

  const groups = []
  for (const [client, clientEntries] of byClient) {
    const hours = sumHours(clientEntries)
    if (client === '') {
      groups.push({ client: '', isUnassigned: true, hours, projects: groupProjectsWithReason(clientEntries) })
    } else {
      groups.push({ client, isUnassigned: false, hours, weeks: groupWeeks(clientEntries) })
    }
  }

  return groups.sort((a, b) => {
    if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? -1 : 1
    return b.hours - a.hours || a.client.localeCompare(b.client, 'es')
  })
}

/**
 * Agrupa horas —ya filtradas por allocation por el llamador— para las tabs de
 * SÓLO LECTURA de Billing (Overage, SP internal, X). Agrupa por una entidad
 * (`entityKey`: el contractor 'user' o el 'client') → horas, con o sin sub-nivel
 * de semana ISO:
 *   - Overage:     entityKey 'user',   withWeeks true  (contractor · semana)
 *   - SP internal: entityKey 'client', withWeeks true  (cliente · semana)
 *   - X (unknown): entityKey 'user',   withWeeks false (contractor)
 *
 * Sólo cuenta horas Approved y NO facturadas (isInvoiced): las no aprobadas
 * todavía no son accionables, y las ya facturadas no son "pendientes" — igual base
 * que la tab bill_to_client, para que los contadores de las tabs sean comparables.
 * Ordena las entidades por horas desc.
 *
 * @param {Array<object>} entries
 * @param {'user'|'client'} entityKey
 * @param {{ withWeeks?: boolean, isInvoiced?: (entry: object) => boolean }} opts
 * @returns {Array<{ entity: string, hours: number, weeks?: Array, rows?: Array }>}
 */
export function groupReadonly(entries = [], entityKey, { withWeeks = true, isInvoiced = () => false } = {}) {
  const approved = (entries ?? []).filter(
    (entry) => entry && entry.status === 'Approved' && !isInvoiced(entry),
  )
  const byEntity = new Map()
  for (const entry of approved) {
    const entity = entry[entityKey] || ''
    if (!byEntity.has(entity)) byEntity.set(entity, [])
    byEntity.get(entity).push(entry)
  }
  return [...byEntity.entries()]
    .map(([entity, entityEntries]) => ({
      entity,
      hours: sumHours(entityEntries),
      ...(withWeeks ? { weeks: groupWeeks(entityEntries) } : { rows: groupRows(entityEntries) }),
    }))
    .sort((a, b) => b.hours - a.hours || a.entity.localeCompare(b.entity, 'es'))
}
