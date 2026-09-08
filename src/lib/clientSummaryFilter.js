/**
 * Filtrado puro de la salida de clientSummaryWeekly (sin React ni red), extraído
 * para poder testearse aislado con `node --test`.
 *
 * Combina las categorías con AND y, dentro de cada una, con OR. El filtro Week
 * actúa a nivel de fila-semana: recorta las semanas visibles de cada proyecto y
 * descarta el proyecto (y el cliente) que quede sin ninguna semana visible.
 * NO recalcula cumulative/remaining de las semanas: son acumulados all-time y se
 * conservan tal cual los dejó el motor.
 */

import { weekLabel } from './clientSummaryWeekly.js'

/**
 * @param {object[]} clients  summary.clients del motor
 * @param {{ clients?: string[], projectNumbers?: string[], projectNames?: string[],
 *           sows?: string[], weeks?: string[] }} filters  cada uno una lista de
 *           valores seleccionados (vacío = sin filtrar). `weeks` son rótulos
 *           (weekLabel), únicos por semana física.
 * @returns {object[]} clientes filtrados (nuevos objetos donde hubo recorte)
 */
export function filterClientSummary(clients, filters = {}) {
  const {
    clients: selClients = [],
    projectNumbers = [],
    projectNames = [],
    sows = [],
    weeks = [],
  } = filters

  const weekActive = weeks.length > 0
  const sowMatch = (p) => {
    if (!sows.length) return true
    return (p.sowNumbers ?? []).some((s) => sows.includes(s))
  }

  const result = []
  for (const group of clients) {
    if (selClients.length && !selClients.includes(group.client)) continue
    const projects = []
    for (const p of group.projects) {
      if (projectNumbers.length && !projectNumbers.includes(p.projectNumber)) continue
      if (projectNames.length && !projectNames.includes(p.projectName)) continue
      if (!sowMatch(p)) continue
      const wk = weekActive ? p.weeks.filter((w) => weeks.includes(weekLabel(w))) : p.weeks
      if (weekActive && wk.length === 0) continue
      projects.push(wk === p.weeks ? p : { ...p, weeks: wk })
    }
    if (projects.length) result.push({ ...group, projects })
  }
  return result
}
