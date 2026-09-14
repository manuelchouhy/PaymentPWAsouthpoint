import { parseBudgetInput } from './budgetInput.js'

/**
 * Calcula, de forma pura, el plan de guardado del editor "Edit Budget Hours":
 * qué cambió respecto del proyecto original (y solo eso se persiste). Valida cada
 * input con parseBudgetInput ({ allowEmpty: true, allowZero: true } — vacío = sin
 * cargar, 0 válido). No toca React ni Supabase.
 *
 * @param {{ hasStages: boolean, baseBudgetHours: ?number, activeStageId: (string|number|null), stages: {id:(string|number), budgetHours:?number}[] }} original
 * @param {{ baseBudgetInput?: string, activeStageId?: (string|number|null), stageInputs?: Object }} edited
 * @returns {{ error: ?string, baseBudgetChange: ?{value:?number}, stageBudgetChanges: {id:(string|number), value:?number}[], activeStageChange: ?{value:(string|number|null)} }}
 */
export function buildBudgetSavePlan(original, edited) {
  const empty = { error: null, baseBudgetChange: null, stageBudgetChanges: [], activeStageChange: null }

  if (!original.hasStages) {
    const { value, error } = parseBudgetInput(edited.baseBudgetInput, { allowEmpty: true, allowZero: true })
    if (error) return { ...empty, error }
    if (value === (original.baseBudgetHours ?? null)) return empty
    return { ...empty, baseBudgetChange: { value } }
  }

  // Con stages: cada input de stage se valida y solo los que cambiaron se guardan.
  const stageInputs = edited.stageInputs ?? {}
  const stageBudgetChanges = []
  for (const stage of original.stages ?? []) {
    const { value, error } = parseBudgetInput(stageInputs[stage.id], { allowEmpty: true, allowZero: true })
    if (error) return { ...empty, error }
    if (value !== (stage.budgetHours ?? null)) stageBudgetChanges.push({ id: stage.id, value })
  }

  const activeChanged =
    String(edited.activeStageId ?? '') !== String(original.activeStageId ?? '')
  const activeStageChange = activeChanged ? { value: edited.activeStageId ?? null } : null

  return { error: null, baseBudgetChange: null, stageBudgetChanges, activeStageChange }
}
