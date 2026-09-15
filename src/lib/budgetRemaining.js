/**
 * Cálculo puro del budget DISPONIBLE de un proyecto en scope: lo que queda del
 * presupuesto una vez descontado lo consumido. Es la resta que alimenta el cuadro
 * "Budget remaining" de Billing, extraída como módulo puro para testearse aislado
 * con `node --test`.
 *
 * `budget` y `consumed` vienen de projectStatsFor (BillingPage): budget = budget del
 * stage activo + CRs aprobados (o null si no hay un proyecto único / budget resoluble);
 * consumed = horas Approved bill_to_client del proyecto.
 *
 * Contrato:
 *   - budget null (sin proyecto único o sin budget cargado) → null (el cuadro muestra "—").
 *   - remaining = budget − consumed. Puede ser NEGATIVO (consumido > budget = over budget):
 *     NO se clampea a 0, para no ocultar el overage; el consumidor lo marca visualmente.
 *   - consumed ausente/no numérico cuenta como 0 (no envenena con NaN).
 *
 * @param {{ budget: ?number, consumed: ?number }} stats
 * @returns {?number} horas restantes (puede ser negativo), o null si no hay budget.
 */
export function remainingBudgetHours({ budget, consumed } = {}) {
  if (budget == null) return null
  const b = Number(budget)
  if (Number.isNaN(b)) return null
  return b - (Number(consumed) || 0)
}
