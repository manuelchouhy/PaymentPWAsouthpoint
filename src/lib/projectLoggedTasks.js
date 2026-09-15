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
 * @returns {Array<{ id: string, taskName: string, taskNumber: (string|null), taskKey: (string|null), hours: number, consumedHours: number }>}
 *   taskKey = key corto de Zoho, sólo para display, atado al taskNumber elegido (ver abajo).
 */
export function aggregateLoggedTasks(rows = []) {
  const byTask = new Map()
  for (const row of rows ?? []) {
    const name = row.task ?? ''
    if (!name) continue
    const acc =
      byTask.get(name) ??
      { id: name, taskName: name, taskNumber: null, taskKey: null, hours: 0, consumedHours: 0 }
    // taskNumber + taskKey se capturan ATADOS: el key (display) tiene que corresponder al
    // MISMO task de Zoho que el número (tooltip/traza), o mostraríamos el key de un task y el
    // id de otro cuando dos filas colisionan por nombre. Se toma el par del primer row con
    // número; un row posterior CON EL MISMO número puede completar el key si faltaba.
    const num = row.task_number ?? row.taskNumber
    const numStr = num != null && String(num) !== '' ? String(num) : null
    const k = row.task_key ?? row.taskKey
    const keyStr = k != null && String(k) !== '' ? String(k) : null
    if (acc.taskNumber == null && numStr != null) {
      acc.taskNumber = numStr
      acc.taskKey = keyStr
    } else if (acc.taskKey == null && numStr != null && numStr === acc.taskNumber) {
      acc.taskKey = keyStr
    }
    const h = Number(row.hours) || 0
    acc.hours += h // total logged (cualquier estado/allocation)
    if (row.status === 'Approved' && isConsumedAllocation(row.allocation)) acc.consumedHours += h
    byTask.set(name, acc)
  }
  return [...byTask.values()].sort((a, b) => a.taskName.localeCompare(b.taskName, 'es', { numeric: true }))
}
