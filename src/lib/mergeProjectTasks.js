/**
 * Une los tasks del proyecto de dos fuentes, matcheando por NOMBRE normalizado (trim),
 * módulo puro:
 *  - REGISTRADOS: project_tasks del SOW (con `stageId` = a qué stage pertenecen, y
 *    `estimatedHours`). Son los que se asignan a un stage en el wizard.
 *  - LOGUEADOS: los distintos `task` de las horas cargadas en Zoho (con `taskNumber`,
 *    `hours` y `consumedHours`, ya deduplicados por nombre). Ver aggregateLoggedTasks.
 *
 * Salida: una fila por task para el árbol de Projects & SOW. Se CONSERVAN todos los
 * registrados (aunque compartan nombre — son project_tasks distintos, con su stage). El
 * consumido/id-de-Zoho del logueado que matchea el nombre se atribuye al PRIMER registrado
 * con ese nombre (evita doble conteo si hay nombres repetidos). Un task logueado sin
 * registrar aparece con `stageId: null` (sin asignar), para que se note. `taskId` es el id
 * de project_tasks (para asignarle un stage) o null si no está registrado.
 *
 * @param {Array<{id:(string|number), taskName:string, stageId:(string|number|null), estimatedHours?:number}>} registered
 * @param {Array<{taskName:string, taskNumber?:(string|null), taskKey?:(string|null), hours?:number, consumedHours?:number}>} logged
 * @returns {Array<{taskId:(string|number|null), taskName:string, taskNumber:(string|null), taskKey:(string|null),
 *   stageId:(string|number|null), estimatedHours:number, hours:number, consumedHours:number, registered:boolean}>}
 */
// Clave de matcheo: trim + colapsar espacios internos + lowercase, para que "Backend ",
// "Backend" y "backend" (SOW vs Zoho) matcheen la misma task en vez de partirse en dos.
const norm = (name) => String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
// String-or-null: normaliza un valor a string no vacío o null. NO es coerción numérica —
// se usa tanto para taskNumber (id largo) como para taskKey (código corto "PP1-T1"), así
// que NO cambiar a Number() (rompería las keys alfanuméricas).
const toStr = (v) => (v != null && String(v) !== '' ? String(v) : null)

export function mergeProjectTasks(registered = [], logged = []) {
  // Logueados por nombre normalizado. Si dos logueados colapsan a la misma clave (ej.
  // "Backend" y "Backend "), se SUMAN sus horas (no se descarta el segundo).
  const loggedByKey = new Map()
  for (const l of logged ?? []) {
    const key = norm(l?.taskName)
    if (!key) continue
    let acc = loggedByKey.get(key)
    if (!acc) {
      acc = { taskName: l.taskName ?? '', taskNumber: null, taskKey: null, hours: 0, consumedHours: 0 }
      loggedByKey.set(key, acc)
    }
    acc.hours += Number(l.hours) || 0
    acc.consumedHours += Number(l.consumedHours) || 0
    const num = toStr(l.taskNumber)
    if (acc.taskNumber == null && num != null) acc.taskNumber = num
    // taskKey de CUALQUIER logueado cuyo number coincida con el resuelto (key inmutable por
    // number → no cruza key↔id entre homónimos de OTRO number; y recupera la key aunque el
    // primer logueado del number aún no la tuviera). null hasta que aparezca ese number con key.
    if (acc.taskKey == null && num != null && num === acc.taskNumber) {
      const lkey = toStr(l.taskKey)
      if (lkey != null) acc.taskKey = lkey
    }
  }

  const out = []
  const usedKeys = new Set() // nombres normalizados a los que ya se les atribuyó el logueado
  for (const r of registered ?? []) {
    const name = r?.taskName ?? ''
    const key = norm(name)
    if (!key) continue
    // El consumido va al PRIMER registrado con ese nombre; los siguientes quedan en 0.
    const l = usedKeys.has(key) ? undefined : loggedByKey.get(key)
    usedKeys.add(key)
    out.push({
      taskId: r.id ?? null,
      taskName: name,
      taskNumber: toStr(l?.taskNumber),
      taskKey: toStr(l?.taskKey),
      stageId: r.stageId ?? null,
      estimatedHours: Number(r.estimatedHours) || 0,
      hours: l ? Number(l.hours) || 0 : 0,
      consumedHours: l ? Number(l.consumedHours) || 0 : 0,
      registered: true,
    })
  }
  // Logueados sin registrar (no matchean ningún nombre de project_tasks).
  for (const [key, l] of loggedByKey) {
    if (usedKeys.has(key)) continue
    out.push({
      taskId: null,
      taskName: l.taskName ?? '',
      taskNumber: toStr(l.taskNumber),
      taskKey: toStr(l.taskKey),
      stageId: null,
      estimatedHours: 0,
      hours: Number(l.hours) || 0,
      consumedHours: Number(l.consumedHours) || 0,
      registered: false,
    })
  }
  return out.sort((a, b) => a.taskName.localeCompare(b.taskName, 'es', { numeric: true }))
}
