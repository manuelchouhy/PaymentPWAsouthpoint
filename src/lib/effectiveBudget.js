/**
 * Cálculo puro del presupuesto vigente de un proyecto (sin dependencias de
 * Supabase ni de red), extraído de changeRequestsData para poder testearse
 * aislado con `node --test` y reusarse desde el motor de Client Summary.
 *
 * Presupuesto vigente = base del SOW + lo aprobado que amplía budget. Los
 * write_off_overage no suman: son horas que SouthPoint absorbe, no horas nuevas
 * que el cliente autorizó.
 *
 * @param {?number} baseBudgetHours
 * @param {{ status: string, type: string, deltaHours: number }[]} changeRequests
 * @returns {?number} null si el proyecto no tiene presupuesto base cargado.
 */
export function effectiveBudgetHours(baseBudgetHours, changeRequests = []) {
  if (baseBudgetHours == null) return null
  return changeRequests
    .filter((cr) => cr.status === 'approved' && cr.type === 'expand_budget')
    // `Number(...) || 0`: un deltaHours ausente/no numérico aporta 0 en vez de
    // envenenar todo el presupuesto con NaN (el data-layer ya lo mapea con
    // Number(), pero el módulo puro no debe confiar en eso).
    .reduce((total, cr) => total + (Number(cr.deltaHours) || 0), Number(baseBudgetHours))
}
