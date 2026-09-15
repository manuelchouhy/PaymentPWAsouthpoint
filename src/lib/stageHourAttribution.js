/**
 * Atribución pura de horas a los stages internos de un proyecto (sin dependencias de
 * Supabase ni de red). Es la base del "consumed por stage" y del futuro filtro de Stage
 * en Billing: cada hora (entry) está ligada a un task, y cada stage es una lista de
 * tasks (membresía `project_tasks.stage_id`). Con el mapa task→stage, este módulo reparte
 * las horas por stage.
 *
 * El módulo NO sabe de dónde sale el mapa (lo arma el caller a partir de project_tasks):
 * sólo hace el lookup por el identificador de task de cada hora (`entry.taskNumber`, el id
 * de Zoho) y suma. Una hora cuyo task no está en el mapa (o que no tiene task) va a
 * `noStage` — nunca se pierde ni se atribuye a un stage arbitrario.
 *
 * @param {Array<{id:(string|number), taskNumber?:(string|number|null), hours?:number}>} entries
 * @param {Map<string,(string|number)> | Record<string,(string|number)>} [taskToStage]
 *   Mapa task (id de Zoho, como string) → stageId. Acepta Map o objeto plano.
 * @returns {{ byStage: Record<string,{hours:number, entryIds:string[]}>, noStage: {hours:number, entryIds:string[]} }}
 *   `byStage` keyed por stageId (string); `noStage` junta las horas sin stage resoluble.
 */
export function attributeHoursByStage(entries = [], taskToStage) {
  // Se normaliza el mapa a claves string UNA vez (Map u objeto → Map string-keyed): así el
  // lookup matchea aunque el mapa venga con claves numéricas (Map([[1003,'S1']])) y el
  // taskNumber numérico de la data. Sin esto, un Map con clave numérica nunca matchearía.
  const stageByTask = new Map()
  if (taskToStage instanceof Map) {
    for (const [k, v] of taskToStage) stageByTask.set(String(k), v)
  } else if (taskToStage && typeof taskToStage === 'object') {
    for (const k of Object.keys(taskToStage)) stageByTask.set(k, taskToStage[k])
  }
  const lookup = (taskKey) => (taskKey == null ? null : stageByTask.get(String(taskKey)) ?? null)

  const byStage = {}
  const noStage = { hours: 0, entryIds: [] }

  // Array.isArray: un `entries` null/no-iterable (query que devolvió null) no debe tirar
  // TypeError; se trata como vacío (el default `= []` sólo cubre undefined).
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry == null) continue // elemento nulo en la lista: se saltea (no ensucia entryIds)
    const hours = Number(entry.hours) || 0
    const id = String(entry.id)
    const stageId = lookup(entry.taskNumber)
    // stageId ausente ('' incluido, p. ej. una columna de texto que guardó '' en vez de
    // NULL) → noStage. Un stage real siempre tiene id no vacío.
    if (stageId == null || stageId === '') {
      noStage.hours += hours
      noStage.entryIds.push(id)
      continue
    }
    // stageId normalizado a string: así '7' (numérico) y '7' (string) son el mismo bucket.
    const key = String(stageId)
    const bucket = byStage[key] ?? (byStage[key] = { hours: 0, entryIds: [] })
    bucket.hours += hours
    bucket.entryIds.push(id)
  }

  return { byStage, noStage }
}
