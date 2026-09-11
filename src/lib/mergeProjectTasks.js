/**
 * Une los tasks del proyecto de dos fuentes, matcheando por NOMBRE (módulo puro):
 *  - REGISTRADOS: project_tasks del SOW (con `stageId` = a qué stage pertenecen, y
 *    `estimatedHours`). Son los que se asignan a un stage en el wizard.
 *  - LOGUEADOS: los distintos `task` de las horas cargadas en Zoho (con `taskNumber`,
 *    `hours` y `consumedHours`). Ver getProjectLoggedTasks / aggregateLoggedTasks.
 *
 * Salida: una lista de tasks para el árbol de Projects & SOW. Un task registrado toma su
 * consumido/id-de-Zoho del logueado que matchea el nombre; un task logueado sin registrar
 * aparece igual con `stageId: null` (sin asignar), para que se note. `taskId` es el id de
 * project_tasks (para poder asignarle un stage) o null si no está registrado.
 *
 * @param {Array<{id:(string|number), taskName:string, stageId:(string|number|null), estimatedHours?:number}>} registered
 * @param {Array<{taskName:string, taskNumber?:(string|null), hours?:number, consumedHours?:number}>} logged
 * @returns {Array<{taskId:(string|number|null), taskName:string, taskNumber:(string|null),
 *   stageId:(string|number|null), estimatedHours:number, hours:number, consumedHours:number, registered:boolean}>}
 */
export function mergeProjectTasks(registered = [], logged = []) {
  const byName = new Map()
  for (const r of registered ?? []) {
    const name = r?.taskName ?? ''
    if (!name) continue
    byName.set(name, {
      taskId: r.id ?? null,
      taskName: name,
      taskNumber: null,
      stageId: r.stageId ?? null,
      estimatedHours: Number(r.estimatedHours) || 0,
      hours: 0,
      consumedHours: 0,
      registered: true,
    })
  }
  for (const l of logged ?? []) {
    const name = l?.taskName ?? ''
    if (!name) continue
    const existing = byName.get(name)
    if (existing) {
      if (l.taskNumber != null && String(l.taskNumber) !== '') existing.taskNumber = String(l.taskNumber)
      existing.hours = Number(l.hours) || 0
      existing.consumedHours = Number(l.consumedHours) || 0
    } else {
      byName.set(name, {
        taskId: null,
        taskName: name,
        taskNumber: l.taskNumber != null && String(l.taskNumber) !== '' ? String(l.taskNumber) : null,
        stageId: null,
        estimatedHours: 0,
        hours: Number(l.hours) || 0,
        consumedHours: Number(l.consumedHours) || 0,
        registered: false,
      })
    }
  }
  return [...byName.values()].sort((a, b) => a.taskName.localeCompare(b.taskName, 'es', { numeric: true }))
}
