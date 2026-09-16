/**
 * Aplicación pura del Filtro de Stage sobre horas (sin React ni red). Es el helper que
 * consumen las páginas de horas (Entries, Payments, Dashboard, Billing) para recortar las
 * horas a los stages elegidos, vía la atribución task→stage (ver stageHourAttribution.js).
 * Ver el término "Filtro de Stage" en CONTEXT.md.
 */

/**
 * Deja sólo las horas cuya Task pertenece a alguno de los stages elegidos.
 *
 * Sin stages elegidos (`selectedIds` vacío) NO filtra: devuelve `entries` tal cual, para que
 * el caller pueda aplicar este helper siempre sin ramas. La atribución es por `entry.taskNumber`
 * (id de tarea de Zoho) contra `taskToStage`; una hora sin task o con task fuera del mapa no
 * matchea ningún stage.
 *
 * @param {object[]} entries
 * @param {Map<string,(string|number)> | Record<string,(string|number)>} taskToStage
 * @param {Iterable<(string|number)>} selectedIds stage_id elegidos (Array o Set).
 * @returns {object[]}
 */
export function filterEntriesByStage(entries = [], taskToStage, selectedIds) {
  const list = Array.isArray(entries) ? entries : []
  const selected = new Set()
  for (const id of selectedIds ?? []) selected.add(String(id))
  if (selected.size === 0) return entries

  const stageByTask = new Map()
  if (taskToStage instanceof Map) {
    for (const [k, v] of taskToStage) stageByTask.set(String(k), String(v))
  } else if (taskToStage && typeof taskToStage === 'object') {
    for (const k of Object.keys(taskToStage)) stageByTask.set(k, String(taskToStage[k]))
  }

  return list.filter((e) => {
    const sid = stageByTask.get(String(e?.taskNumber ?? ''))
    return sid != null && selected.has(sid)
  })
}
