import { isoWeek } from './format.js'

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
const rowKey = (entry) => `${entry.user ?? ''}||${entry.project ?? ''}||${entry.task ?? ''}`

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
 */
function groupWeeks(entries) {
  const byWeek = new Map()
  for (const entry of entries) {
    const weekNum = isoWeek(entry.date ?? '')
    const key = weekNum ?? 'sin-fecha'
    const date = entry.date ?? ''
    const week = byWeek.get(key)
    if (week) {
      week.entries.push(entry)
      if (date > week.latestDate) week.latestDate = date
    } else {
      byWeek.set(key, {
        weekNum,
        week: weekNum ? `W${weekNum}` : '—',
        latestDate: date,
        entries: [entry],
      })
    }
  }
  return [...byWeek.values()]
    .map((week) => ({
      week: week.week,
      weekNum: week.weekNum,
      latestDate: week.latestDate,
      hours: sumHours(week.entries),
      rows: groupRows(week.entries),
    }))
    .sort((a, b) => (b.latestDate || '').localeCompare(a.latestDate || ''))
}

/**
 * Proyectos del bucket "Sin cliente", cada uno con su motivo de no-resolución y
 * ordenados por horas desc. El motivo se toma de la primera hora del proyecto
 * (todas las horas del mismo proyecto comparten motivo, es propiedad del proyecto).
 */
function groupProjectsWithReason(entries) {
  const byProject = new Map()
  for (const entry of entries) {
    const project = entry.project ?? ''
    const group = byProject.get(project)
    if (group) group.entries.push(entry)
    else byProject.set(project, { project, reason: entry.clientReason ?? null, entries: [entry] })
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
export function groupBillToClient(entries = [], { isInvoiced = () => false } = {}) {
  const billable = (entries ?? []).filter(
    (entry) =>
      entry &&
      entry.allocation === 'bill_to_client' &&
      entry.status === 'Approved' &&
      !isInvoiced(entry),
  )

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
