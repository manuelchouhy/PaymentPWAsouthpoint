/**
 * Motor de agregación semanal de Client Summary (módulo puro, sin React ni red).
 *
 * Produce, por cliente → proyecto → semana (domingo→sábado, year-aware), el
 * consumido y el overage de la semana más el acumulado y el remanente contra el
 * Budget estimado del proyecto. Ver docs/adr/0001 y el término "Budget" en
 * CONTEXT.md.
 *
 * Reglas de dominio:
 *  - Budget = effectiveBudgetHours(baseBudgetHours, changeRequests): estimado de
 *    la SOW + change requests aprobados. Total del proyecto, no por semana.
 *  - Consumed (semana) = horas Approved con allocation bill_to_client.
 *  - Overage (semana)  = horas Approved con allocation overage.
 *  - Cumulative = consumido acumulado en orden cronológico (incluye la semana).
 *  - Remaining  = budget − cumulative (puede ser negativo).
 *  - Granularidad proyecto (no SOW): las entries se atan al proyecto por nombre,
 *    no al SOW. Un proyecto multi-stage suma todos sus SOW en la fila.
 */

import { sundayWeek, sundayWeekYear, weekStartISO } from './format.js'
import { effectiveBudgetHours } from './effectiveBudget.js'

const UNASSIGNED = 'Without client'

/** Nombre de cliente con el que se agrupa un proyecto (mismo criterio que la página). */
function groupNameOf(project) {
  return project.customerName || project.client || UNASSIGNED
}

/** SOW a mostrar: los SOW de stage (coma-separados) si hay, si no el sowNumber. */
function sowLabel(project) {
  if (project.stageSowNumbers && project.stageSowNumbers.length) {
    return project.stageSowNumbers.join(', ')
  }
  return project.sowNumber ?? ''
}

/**
 * @param {{ projects: object[], entries: object[], crsByProject: Map<string, object[]> }} input
 */
export function buildClientSummaryWeekly({ projects = [], entries = [], crsByProject = new Map() }) {
  // Horas por (nombre de proyecto → weekStart) separadas en consumed/overage.
  // Se keyea por NOMBRE de proyecto (entry.project), igual que la página: es la
  // única clave con la que las entries se atan al proyecto.
  const byProjectWeek = new Map()
  for (const e of entries) {
    if (e.status !== 'Approved') continue
    if (e.allocation !== 'bill_to_client' && e.allocation !== 'overage') continue
    const name = e.project ?? ''
    const weekStart = weekStartISO(e.date ?? '')
    if (!weekStart) continue
    const hours = Number(e.hours) || 0
    let weeks = byProjectWeek.get(name)
    if (!weeks) {
      weeks = new Map()
      byProjectWeek.set(name, weeks)
    }
    const acc = weeks.get(weekStart) ?? {
      weekStart,
      sundayWeek: sundayWeek(e.date ?? ''),
      year: sundayWeekYear(e.date ?? ''),
      consumed: 0,
      overage: 0,
    }
    if (e.allocation === 'bill_to_client') acc.consumed += hours
    else acc.overage += hours
    weeks.set(weekStart, acc)
  }

  const byClient = new Map()
  for (const project of projects) {
    const clientName = groupNameOf(project)
    const budget = effectiveBudgetHours(
      project.baseBudgetHours,
      crsByProject.get(String(project.id)) ?? [],
    )

    // Semanas del proyecto, en orden cronológico, con cumulative/remaining.
    // El lookup normaliza el nombre igual que el bucket (`?? ''`) para que
    // coincidan. Se CLONA cada objeto de semana: dos proyectos con el mismo
    // projectName comparten el mismo bucket, y sin el clon la mutación de
    // cumulative/remaining de uno pisaría la del otro (apuntan al mismo objeto).
    const weekMap = byProjectWeek.get(project.projectName ?? '')
    const weeks = weekMap ? [...weekMap.values()].map((w) => ({ ...w })) : []
    weeks.sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    let cumulative = 0
    for (const w of weeks) {
      cumulative += w.consumed
      w.cumulative = cumulative
      w.remaining = budget == null ? null : budget - cumulative
    }

    const row = {
      id: project.id,
      projectName: project.projectName,
      projectNumber: project.projectNumber ?? '',
      sowNumber: sowLabel(project),
      zohoStatus: project.zohoStatus ?? null,
      budget,
      consumed: weeks.reduce((s, w) => s + w.consumed, 0),
      overage: weeks.reduce((s, w) => s + w.overage, 0),
      weeks,
    }

    const group = byClient.get(clientName)
    if (group) group.projects.push(row)
    else byClient.set(clientName, { client: clientName, projects: [row] })
  }

  const clients = [...byClient.values()].sort((a, b) =>
    a.client.localeCompare(b.client, 'es'),
  )
  for (const group of clients) {
    group.projects.sort((a, b) =>
      (a.projectName ?? '').localeCompare(b.projectName ?? '', 'es'),
    )
  }

  const totals = { budget: 0, consumed: 0, overage: 0 }
  for (const group of clients) {
    for (const proj of group.projects) {
      // Budget suma solo proyectos con presupuesto cargado: contar null como 0
      // haría ver consumido > presupuesto en uno al que nunca se le cargó.
      if (proj.budget != null) totals.budget += proj.budget
      totals.consumed += proj.consumed
      totals.overage += proj.overage
    }
  }

  return { clients, totals }
}
