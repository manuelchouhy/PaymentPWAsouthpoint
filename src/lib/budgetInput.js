/**
 * Validación/parseo del input de "Budget Hours" (base_budget_hours). Módulo PURO
 * (sin React ni Supabase), fuente única de verdad de "qué es un budget válido",
 * compartido por el form de edición (ProjectFormModal) y el wizard (Edit SOW &
 * Scope). Ver CONTEXT.md: editar el base = corregir el estimado del SOW.
 *
 * @param {unknown} raw  valor crudo del input (string del form, o number/null).
 * @param {{ allowEmpty?: boolean, allowZero?: boolean }} [opts]
 *   allowEmpty: vacío → { value: null } en vez de error (el form lo permite; el
 *     wizard no). allowZero: 0 es válido (corrección) vs. debe ser > 0 (wizard).
 * @returns {{ value: number|null, error: string|null }}
 */
export function parseBudgetInput(raw, { allowEmpty = false, allowZero = true } = {}) {
  const trimmed = String(raw ?? '').trim()
  if (trimmed === '') {
    return allowEmpty ? { value: null, error: null } : { value: null, error: 'Budget hours are required.' }
  }
  const n = Number(trimmed)
  if (!Number.isFinite(n)) return { value: null, error: 'Budget hours must be a number.' }
  if (n < 0) return { value: null, error: "Budget hours can't be negative." }
  if (n === 0 && !allowZero) return { value: null, error: 'Budget hours must be greater than 0.' }
  return { value: n, error: null }
}
