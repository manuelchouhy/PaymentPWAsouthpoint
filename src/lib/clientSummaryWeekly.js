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
 *  - Consumed (semana) = horas Approved con allocation bill_to_client (clientes con
 *    budget) o sp_internal (proyectos internos → SouthPoint Internal, sin budget).
 *  - Pending (semana)  = horas bill_to_client o sp_internal con status Pending (aún
 *    sin aprobar en Zoho). NO cuentan como Consumed ni afectan cumulative/remaining.
 *  - Overage (semana)  = horas Approved con allocation overage.
 *  - Rejected y demás estados se descartan.
 *  - Cumulative = consumido acumulado en orden cronológico (incluye la semana).
 *  - Remaining  = budget − cumulative (puede ser negativo).
 *  - Granularidad proyecto (no SOW): las entries se atan al proyecto por nombre,
 *    no al SOW. Un proyecto multi-stage suma todos sus SOW en la fila.
 */

import { sundayWeek, sundayWeekYear, weekStartISO } from './format.js'
import { resolveProjectBudget, normBudget } from './projectStageBudget.js'
import { effectiveBudgetHours } from './effectiveBudget.js'
import { isConsumedAllocation } from './allocations.js'
import { normalizeTaskToStage } from './stageFilter.js'

const UNASSIGNED = 'Without client'

/** Rótulo de semana year-aware, ej. "WEEK 35 · 2026". Único por semana física. */
export function weekLabel(week) {
  return `WEEK ${week.sundayWeek} · ${week.year}`
}

/**
 * ¿Esta hora cuenta para la agregación de Client Summary? Es el MISMO criterio de inclusión que
 * usa el motor abajo: allocation consumida (bill_to_client/sp_internal) u overage, y status
 * Approved (consumed/overage) o Pending de una allocation consumida. Se exporta para que el
 * cálculo de "qué stages tienen horas" (opciones del filtro de Stage en la página) use el mismo
 * criterio y no ofrezca un stage cuyas horas el motor descarta (Rejected, overage Pending, etc.).
 */
export function entryCountsForConsumption(e) {
  if (!isConsumedAllocation(e.allocation) && e.allocation !== 'overage') return false
  const isApproved = e.status === 'Approved'
  const isPending = e.status === 'Pending' && isConsumedAllocation(e.allocation)
  return isApproved || isPending
}

/**
 * Nombre de cliente con el que se agrupa un proyecto. Prefiere `resolvedClient`
 * (cliente resuelto por buildClientResolver: cadena manual→grupo→legacy, que la
 * página anota antes de llamar al motor); si no viene, cae al texto legacy
 * (customerName || client) y por último a "Without client". El fallback mantiene
 * al motor usable sin el resolver (tests, modo sin clients).
 */
function groupNameOf(project) {
  return project.resolvedClient || project.customerName || project.client || UNASSIGNED
}

/**
 * SOW del proyecto como lista: los SOW de stage si el proyecto es multi-stage, si
 * no el sowNumber suelto. Es la fuente para el rótulo (join) y para el filtro por
 * SOW individual — así el filtro no depende de re-parsear el string unido.
 */
function sowList(project) {
  if (project.stageSowNumbers && project.stageSowNumbers.length) return project.stageSowNumbers
  return project.sowNumber ? [project.sowNumber] : []
}

/**
 * @param {{ projects: object[], entries: object[], crsByProject: Map<string, object[]>,
 *          stagesByProject?: Map<string, object[]>, isInvoiced?: (entry: object) => boolean }} input
 *   - stagesByProject: stages internos por projectId (para el budget del stage
 *     activo). Un proyecto sin entrada acá se trata como sin stages (budget = base).
 *   - isInvoiced (C11): marca una hora ya facturada al cliente. `invoiced` es un
 *     SUBCONJUNTO de `consumed`: sólo horas Approved bill_to_client que además ya se
 *     facturaron (sp_internal no se factura al cliente, así que nunca cuenta acá aunque
 *     el predicado la marque). Por semana y total del proyecto.
 */
export function buildClientSummaryWeekly({
  projects = [],
  entries = [],
  crsByProject = new Map(),
  stagesByProject = new Map(),
  isInvoiced = () => false,
  taskToStage = undefined,
  selectedStageIds = undefined,
}) {
  // Filtro de Stage (ADR 0004). Con stages elegidos, la fila se RECALCULA al/los stage(s):
  // sólo horas cuya Task pertenece a esos stages, budget = suma de sus budget_hours, y los
  // proyectos sin ninguno de esos stages no producen fila. Sin stages elegidos, TODO lo de
  // abajo queda igual que antes (no-regresión; no se toca la rama sin-filtro).
  const selectedStages = new Set()
  for (const id of selectedStageIds ?? []) selectedStages.add(String(id))
  const stageActive = selectedStages.size > 0
  const stageByTask = stageActive ? normalizeTaskToStage(taskToStage) : null
  // stage_id → projectId dueño (desde stagesByProject). Bajo filtro, las horas se atribuyen al
  // proyecto DUEÑO del stage de su task (por id), no por el nombre de proyecto de la entry: así
  // dos proyectos con el mismo nombre pero stages distintos no mezclan su consumo.
  const stageToProject = new Map()
  if (stageActive) {
    for (const [pid, stages] of stagesByProject) {
      for (const s of stages ?? []) stageToProject.set(String(s.id), String(pid))
    }
  }

  // Horas por (nombre de proyecto → weekStart) separadas en consumed/overage.
  // Se keyea por NOMBRE de proyecto (entry.project), igual que la página: es la
  // única clave con la que las entries se atan al proyecto.
  const byProjectWeek = new Map()
  // Allocations que cuentan como "consumido" del proyecto: bill_to_client (clientes
  // con budget) y sp_internal (proyectos internos de la empresa → cliente SouthPoint
  // Internal, sin budget). overage se contabiliza aparte. Ver CONTEXT.md ("Consumed"
  // y "SP internal") y docs/adr/0002.
  for (const e of entries) {
    // Se procesan: Approved (consumed/overage) y Pending de una allocation "consumed" (horas
    // aún sin aprobar en Zoho). Las Rejected, cualquier otro estado y overage Pending se
    // descartan. Mismo criterio que exporta entryCountsForConsumption (lo reusa la página).
    if (!entryCountsForConsumption(e)) continue
    const isPending = e.status === 'Pending' && isConsumedAllocation(e.allocation)
    // Filtro de Stage: sólo horas cuya Task pertenece a alguno de los stages elegidos
    // (atribución por taskNumber → stage). Sin filtro activo no se descarta nada.
    let sid = null
    if (stageActive) {
      sid = stageByTask.get(String(e.taskNumber ?? ''))
      if (sid == null || !selectedStages.has(sid)) continue
    }
    // Clave del bucket: bajo filtro de stage, el proyecto DUEÑO del stage de la task (id), para
    // no mezclar dos proyectos con el mismo nombre; sin filtro, el NOMBRE de proyecto (única
    // clave con la que la entry se ata al proyecto). Una entry que no resuelve a ninguna clave
    // (sin nombre, o cuyo stage no tiene proyecto dueño conocido) se descarta.
    const bucketKey = stageActive ? stageToProject.get(sid) : (e.project ?? '')
    if (bucketKey == null || bucketKey === '') continue
    const weekStart = weekStartISO(e.date ?? '')
    if (!weekStart) continue
    const hours = Number(e.hours) || 0
    let weeks = byProjectWeek.get(bucketKey)
    if (!weeks) {
      weeks = new Map()
      byProjectWeek.set(bucketKey, weeks)
    }
    const acc = weeks.get(weekStart) ?? {
      weekStart,
      sundayWeek: sundayWeek(e.date ?? ''),
      year: sundayWeekYear(e.date ?? ''),
      consumed: 0,
      overage: 0,
      pending: 0,
      invoiced: 0,
    }
    if (isPending) acc.pending += hours
    else if (e.allocation === 'overage') acc.overage += hours
    else {
      acc.consumed += hours // bill_to_client o sp_internal Approved
      // invoiced ⊆ consumed: sólo bill_to_client facturada (sp_internal no se
      // factura al cliente aunque el predicado la marcara).
      if (e.allocation === 'bill_to_client' && isInvoiced(e)) acc.invoiced += hours
    }
    weeks.set(weekStart, acc)
  }

  const byClient = new Map()
  for (const project of projects) {
    const clientName = groupNameOf(project)
    const projectStages = stagesByProject.get(String(project.id)) ?? []

    let budget
    let effectiveTotalBudget
    if (stageActive) {
      // Filtro de Stage (ADR 0004): un proyecto sin ninguno de los stages elegidos NO produce
      // fila (desaparece; su cliente también si se queda sin proyectos). El budget de la fila
      // pasa a ser la SUMA de los budget_hours (normalizados con normBudget, misma regla que
      // resolveProjectBudget) de los stages elegidos, MÁS los change requests expand_budget
      // aprobados del proyecto — igual que activeBudget en la rama sin-filtro (effectiveBudgetHours),
      // para que el mismo número no cambie al filtrar por el stage activo. Si ninguno de los stages
      // elegidos tiene budget válido, budget = null (→ remaining en blanco, como sin-filtro).
      const chosen = projectStages.filter((s) => selectedStages.has(String(s.id)))
      if (chosen.length === 0) continue
      const budgets = chosen.map((s) => normBudget(s.budgetHours)).filter((n) => n != null)
      const chosenSum = budgets.length ? budgets.reduce((sum, n) => sum + n, 0) : null
      budget = effectiveBudgetHours(chosenSum, crsByProject.get(String(project.id)) ?? [])
      effectiveTotalBudget = budget
    } else {
      // Budget contra el que se mide el consumo = el del STAGE ACTIVO si el proyecto tiene
      // stages internos; si no, la base + CRs (idéntico a antes). `totalBudget` (suma de stages,
      // o la base sin stages) viaja como referencia. Ver projectStageBudget.js.
      const resolved = resolveProjectBudget(
        project,
        projectStages,
        crsByProject.get(String(project.id)) ?? [],
      )
      budget = resolved.activeBudget
      effectiveTotalBudget = resolved.totalBudget
    }

    // Semanas del proyecto, en orden cronológico, con cumulative/remaining. Se CLONA cada objeto
    // de semana: dos proyectos con el mismo projectName comparten el mismo bucket, y sin el clon
    // la mutación de cumulative/remaining de uno pisaría la del otro. Clave del bucket: bajo
    // filtro de stage es el id del proyecto (bucketeo por dueño del stage); si no, el nombre.
    const weekMap = byProjectWeek.get(stageActive ? String(project.id) : project.projectName)
    const weeks = weekMap ? [...weekMap.values()].map((w) => ({ ...w })) : []
    weeks.sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    // Una sola pasada: cumulative/remaining por semana y los totales del proyecto.
    let cumulative = 0
    let consumedTotal = 0
    let overageTotal = 0
    let pendingTotal = 0
    let invoicedTotal = 0
    for (const w of weeks) {
      cumulative += w.consumed
      w.cumulative = cumulative
      w.remaining = budget == null ? null : budget - cumulative
      consumedTotal += w.consumed
      overageTotal += w.overage
      pendingTotal += w.pending
      invoicedTotal += w.invoiced
    }

    const sows = sowList(project)
    const row = {
      id: project.id,
      projectName: project.projectName,
      projectNumber: project.projectNumber ?? '',
      sowNumber: sows.join(', '), // rótulo para la grilla/export
      sowNumbers: sows, // lista para filtrar por SOW individual
      zohoStatus: project.zohoStatus ?? null,
      budget,
      totalBudget: effectiveTotalBudget,
      consumed: consumedTotal,
      overage: overageTotal,
      pending: pendingTotal,
      invoiced: invoicedTotal,
      weeks,
    }

    const group = byClient.get(clientName)
    if (group) group.projects.push(row)
    else byClient.set(clientName, { client: clientName, projects: [row] })
  }

  // Orden numérico (mismo collator que sortedUnique, que arma el dropdown de la
  // página) para que "Client 2" vaya antes que "Client 10" y la grilla coincida
  // con el filtro. Se ordena en los dos niveles: clientes y proyectos.
  const coll = (a, b) => (a ?? '').localeCompare(b ?? '', 'es', { numeric: true })
  const clients = [...byClient.values()].sort((a, b) => coll(a.client, b.client))
  for (const group of clients) {
    group.projects.sort((a, b) => coll(a.projectName, b.projectName))
  }

  // Los totales (por cliente / portfolio / gráficos) los computa la página a
  // partir de este `clients`, porque dependen de los filtros aplicados y el scope
  // de los gráficos difiere del de la grilla. El motor solo entrega la estructura
  // por cliente → proyecto → semana.
  return { clients }
}
