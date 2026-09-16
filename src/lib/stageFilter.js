/**
 * Aplicación pura del Filtro de Stage sobre horas (sin React ni red). Es el helper que
 * consumen las páginas de horas (Entries, Payments, Dashboard, Billing) para recortar las
 * horas a los stages elegidos, vía la atribución task→stage (ver stageHourAttribution.js).
 * Ver el término "Filtro de Stage" en CONTEXT.md.
 */

/**
 * Normaliza un mapa task→stage (Map u objeto plano, claves/valores de cualquier tipo) a un
 * `Map<string,string>`. Única fuente de la normalización del lookup task→stage, reusada por
 * el filtro de acá y por el hook `useStageFilter` (stageOfEntry) para que no diverjan.
 *
 * @param {Map<*,*> | Record<string,*>} taskToStage
 * @returns {Map<string,string>} zoho_task_id (string) → stage_id (string)
 */
export function normalizeTaskToStage(taskToStage) {
  const m = new Map()
  if (taskToStage instanceof Map) {
    for (const [k, v] of taskToStage) m.set(String(k), String(v))
  } else if (taskToStage && typeof taskToStage === 'object') {
    for (const k of Object.keys(taskToStage)) m.set(k, String(taskToStage[k]))
  }
  return m
}

/**
 * Deja sólo las horas cuya Task pertenece a alguno de los stages elegidos.
 *
 * Sin stages elegidos (`selectedIds` vacío) NO filtra: devuelve todas las horas (normalizadas
 * a array), para que el caller pueda aplicar este helper siempre sin ramas. La atribución es
 * por `entry.taskNumber` (id de tarea de Zoho) contra `taskToStage`; una hora sin task o con
 * task fuera del mapa no matchea ningún stage.
 *
 * @param {object[]} entries
 * @param {Map<string,(string|number)> | Record<string,(string|number)>} taskToStage
 * @param {Iterable<(string|number)>} selectedIds stage_id elegidos (Array o Set).
 * @returns {object[]}
 */
/**
 * stage_id (string) de los stages de UN proyecto. `projectStages` es la lista que
 * `getAllStages()` guarda por proyecto (`[{ id, name, budgetHours }]`). Filas sin id se
 * ignoran. Base del row-filter de Projects.
 *
 * @param {Array<{id?:(string|number)}>} projectStages
 * @returns {string[]}
 */
export function projectStageIds(projectStages = []) {
  const out = []
  for (const s of Array.isArray(projectStages) ? projectStages : []) {
    if (s?.id != null && s.id !== '') out.push(String(s.id))
  }
  return out
}

/**
 * ¿El proyecto TIENE alguno de los stages elegidos? Row-filter de Projects (ver decisión (A)
 * del PRD): un proyecto pasa si alguno de sus stages está seleccionado; la fila se muestra
 * entera. Sin stages elegidos NO es responsabilidad de este helper decidir (el caller no lo
 * llama cuando el filtro está inactivo); con `selectedIds` vacío devuelve false.
 *
 * @param {Array<{id?:(string|number)}>} projectStages
 * @param {Iterable<(string|number)>} selectedIds
 * @returns {boolean}
 */
export function projectMatchesStages(projectStages, selectedIds) {
  const selected = new Set()
  for (const id of selectedIds ?? []) selected.add(String(id))
  if (selected.size === 0) return false
  return projectStageIds(projectStages).some((sid) => selected.has(sid))
}

export function filterEntriesByStage(entries = [], taskToStage, selectedIds) {
  const list = Array.isArray(entries) ? entries : []
  const selected = new Set()
  for (const id of selectedIds ?? []) selected.add(String(id))
  if (selected.size === 0) return list

  const stageByTask = normalizeTaskToStage(taskToStage)
  return list.filter((e) => {
    const sid = stageByTask.get(String(e?.taskNumber ?? ''))
    return sid != null && selected.has(sid)
  })
}
