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
 *                 task_key?: (string|null), taskKey?: (string|null),
 *                 hours?: number|string, status?: string, allocation?: string }>} rows
 * @returns {Array<{ id: string, taskName: string, taskNumber: (string|null), taskKey: (string|null), hours: number, consumedHours: number }>}
 */
export function aggregateLoggedTasks(rows = []) {
  const byTask = new Map()
  for (const row of rows ?? []) {
    const name = row.task ?? ''
    if (!name) continue
    const acc =
      byTask.get(name) ?? { id: name, taskName: name, taskNumber: null, taskKey: null, hours: 0, consumedHours: 0 }
    const num = row.task_number ?? row.taskNumber
    const numStr = num != null && String(num) !== '' ? String(num) : null
    if (acc.taskNumber == null && numStr != null) acc.taskNumber = numStr
    // taskKey (código corto de Zoho): se toma de CUALQUIER row cuyo number coincida con el
    // taskNumber resuelto. La key es inmutable por number, así que no cruza key↔id con OTRO
    // number (homónimo renombrado); y recupera la key aunque el primer row del number aún no
    // la tuviera (ventana de backfill). null hasta que aparezca un row de ese number con key.
    if (acc.taskKey == null && numStr != null && numStr === acc.taskNumber) {
      const key = row.task_key ?? row.taskKey
      if (key != null && String(key) !== '') acc.taskKey = String(key)
    }
    const h = Number(row.hours) || 0
    acc.hours += h // total logged (cualquier estado/allocation)
    if (row.status === 'Approved' && isConsumedAllocation(row.allocation)) acc.consumedHours += h
    byTask.set(name, acc)
  }
  return [...byTask.values()].sort((a, b) => a.taskName.localeCompare(b.taskName, 'es', { numeric: true }))
}
