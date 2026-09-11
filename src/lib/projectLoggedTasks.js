import { isConsumedAllocation } from './allocations.js'

/**
 * Agrega las time_entries de un proyecto en tasks (módulo puro, testeable sin red).
 * Agrupa por NOMBRE de task (`row.task`); `taskNumber` es el id de Zoho (task_number en
 * supabase / taskNumber en demo — el primero no vacío gana). `hours` suma TODAS las horas
 * (cualquier estado/allocation = "logged"); `consumedHours` sólo las Approved de allocation
 * consumible (bill_to_client / sp_internal, ver isConsumedAllocation) — mismo criterio que
 * Client Summary.
 *
 * LIMITACIÓN conocida: al agrupar por nombre, si un mismo nombre tiene entries con distinto
 * task_number (task renombrada/duplicada en Zoho), la fila junta las horas de ambas y muestra
 * un solo id (el primero). Es el mismo modelo por-nombre del resto de la app.
 *
 * @param {Array<{ task?: string, task_number?: (string|number|null), taskNumber?: (string|number|null),
 *                 hours?: number|string, status?: string, allocation?: string }>} rows
 * @returns {Array<{ id: string, taskName: string, taskNumber: (string|null), hours: number, consumedHours: number }>}
 */
export function aggregateLoggedTasks(rows = []) {
  const byTask = new Map()
  for (const row of rows ?? []) {
    const name = row.task ?? ''
    if (!name) continue
    const acc =
      byTask.get(name) ?? { id: name, taskName: name, taskNumber: null, hours: 0, consumedHours: 0 }
    if (acc.taskNumber == null) {
      const num = row.task_number ?? row.taskNumber
      if (num != null && String(num) !== '') acc.taskNumber = String(num)
    }
    const h = Number(row.hours) || 0
    acc.hours += h // total logged (cualquier estado/allocation)
    if (row.status === 'Approved' && isConsumedAllocation(row.allocation)) acc.consumedHours += h
    byTask.set(name, acc)
  }
  return [...byTask.values()].sort((a, b) => a.taskName.localeCompare(b.taskName, 'es', { numeric: true }))
}
