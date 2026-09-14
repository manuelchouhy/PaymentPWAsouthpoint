import { effectiveBudgetHours } from './effectiveBudget.js'

/**
 * Normaliza un budget de stage a un número válido o null ("sin cargar"). Se
 * tratan como null: null/undefined, string vacía o de solo espacios, valores no
 * numéricos, y **negativos** (el CHECK `budget_hours >= 0` de la migración 0047
 * los prohíbe; el módulo puro coincide con esa regla en vez de sumar basura). 0
 * es un budget válido y se preserva. No confía en el mapeo de la capa de datos.
 * @param {*} v
 * @returns {?number}
 */
function normBudget(v) {
  // Solo number|string son candidatos: evita que boolean (true→1) o array
  // ([5]→5, []→0) se cuelen como budgets vía Number().
  if (typeof v !== 'number' && typeof v !== 'string') return null
  if (typeof v === 'string' && v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

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

  // Total = suma de los budgets cargados de los stages (null se ignora, 0 cuenta),
  // más los change requests aprobados. Los CRs son a nivel proyecto (no tienen
  // stage_id), así que suman una vez al total igual que al activo — mismo criterio
  // que la rama sin-stages y que el Budget del dominio (estimado + CRs aprobados).
  // Así el contrato es simétrico y activeBudget ≤ totalBudget siempre.
  const loaded = stages
    .map((s) => normBudget(s.budgetHours))
    .filter((v) => v != null)
  const totalRaw = loaded.length ? loaded.reduce((a, b) => a + b, 0) : null
  const totalBudget = effectiveBudgetHours(totalRaw, changeRequests)

  // Active = budget del stage marcado activo + los CRs aprobados. Sin activo → null.
  // Nota: si el stage activo no tiene budget cargado (null), effectiveBudgetHours
  // devuelve null (un CR amplía un budget existente; sin base no hay qué ampliar),
  // consistente con la rama sin-stages y el resto de la app.
  const active = stages.find((s) => String(s.id) === String(activeStageId))
  const activeBudget = active
    ? effectiveBudgetHours(normBudget(active.budgetHours), changeRequests)
    : null

  return { activeBudget, totalBudget, hasStages: true, activeStageId }
}
