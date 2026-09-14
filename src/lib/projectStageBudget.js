import { effectiveBudgetHours } from './effectiveBudget.js'

/**
 * Resolución pura del budget de un proyecto (sin dependencias de Supabase ni de
 * red), única fuente de verdad de "cuál es el budget contra el que se mide el
 * consumo" y "cuánto suma el proyecto en total".
 *
 * Un proyecto puede tener stages internos (`project_stages`) con budget propio.
 * Cuando los tiene, el budget vigente es el del stage ACTIVO (marcado a mano) y
 * el total es la suma de los budgets de sus stages. Sin stages, se comporta como
 * el cálculo clásico a nivel proyecto (`effectiveBudgetHours`).
 *
 * @param {{ baseBudgetHours: ?number, activeStageId: (string|number|null) }} project
 * @param {{ id: (string|number), budgetHours: ?number }[]} stages
 * @param {{ status: string, type: string, deltaHours: number }[]} changeRequests
 * @returns {{ activeBudget: ?number, totalBudget: ?number, hasStages: boolean, activeStageId: (string|number|null) }}
 */
export function resolveProjectBudget(project, stages = [], changeRequests = []) {
  const activeStageId = project.activeStageId ?? null

  if (!stages || stages.length === 0) {
    const budget = effectiveBudgetHours(project.baseBudgetHours, changeRequests)
    return { activeBudget: budget, totalBudget: budget, hasStages: false, activeStageId }
  }

  // Total = suma de los budgets cargados de los stages (null se ignora, 0 cuenta).
  // Los change requests NO suman al total: amplían el trabajo del stage activo, no
  // el alcance planificado de cada stage.
  const loaded = stages
    .map((s) => s.budgetHours)
    .filter((v) => v != null && Number.isFinite(Number(v)))
    .map(Number)
  const totalBudget = loaded.length ? loaded.reduce((a, b) => a + b, 0) : null

  // Active = budget del stage marcado activo + los CRs aprobados. Sin activo → null.
  const active = stages.find((s) => String(s.id) === String(activeStageId))
  const activeBudget = active
    ? effectiveBudgetHours(active.budgetHours, changeRequests)
    : null

  return { activeBudget, totalBudget, hasStages: true, activeStageId }
}
