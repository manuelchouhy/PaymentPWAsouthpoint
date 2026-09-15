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
 * Campo `effectiveTotal`: budget total EFECTIVO contra el que se mide el CONSUMO (lo usa
 * Billing) = suma de stages + CRs; o BASE + CRs si no hay stages, o si hay stages pero
 * NINGUNO con budget cargado (fallback: un proyecto puede tener budget ANTES de que se le
 * agregue un stage — agregarle un stage sin budget no debe hacerlo desaparecer). Apenas un
 * stage tiene budget, manda la suma de stages. NO pisa `totalBudget` (suma pura de stages,
 * que el editor y el Overview muestran con la etiqueta "sum of stages").
 * @returns {{ activeBudget: ?number, totalBudget: ?number, effectiveTotal: ?number, hasStages: boolean, activeStageId: (string|number|null) }}
 */
export function resolveProjectBudget(project, stages = [], changeRequests = []) {
  const activeStageId = project.activeStageId ?? null

  if (!stages || stages.length === 0) {
    const budget = effectiveBudgetHours(project.baseBudgetHours, changeRequests)
    return { activeBudget: budget, totalBudget: budget, effectiveTotal: budget, hasStages: false, activeStageId }
  }

  // Total = suma pura de los budgets cargados de los stages (null se ignora, 0
  // cuenta). NO incluye los change requests ni cae al base: el total es "la suma de
  // los stages" (lo que muestra el editor y el Overview con esa etiqueta), y así
  // reconcilia con la grilla de stages. El fallback al base y los CRs van en
  // `effectiveTotal` (abajo), NO acá, para no romper esa etiqueta.
  const loaded = stages
    .map((s) => normBudget(s.budgetHours))
    .filter((v) => v != null)
  const totalBudget = loaded.length ? loaded.reduce((a, b) => a + b, 0) : null

  // Total EFECTIVO (para medir consumo): suma de stages + CRs; o base + CRs si ningún stage
  // tiene budget (fallback — ver doc). No pisa `totalBudget`.
  const effectiveTotal =
    totalBudget != null
      ? effectiveBudgetHours(totalBudget, changeRequests)
      : effectiveBudgetHours(project.baseBudgetHours, changeRequests)

  // Active = budget del stage marcado activo + los CRs aprobados. Sin activo → null.
  // Nota: si el stage activo no tiene budget cargado (null), effectiveBudgetHours
  // devuelve null (un CR amplía un budget existente; sin base no hay qué ampliar),
  // consistente con la rama sin-stages y el resto de la app.
  const active = stages.find((s) => String(s.id) === String(activeStageId))
  const activeBudget = active
    ? effectiveBudgetHours(normBudget(active.budgetHours), changeRequests)
    : null

  return { activeBudget, totalBudget, effectiveTotal, hasStages: true, activeStageId }
}
