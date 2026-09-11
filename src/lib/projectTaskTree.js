/**
 * Árbol stage → tasks para el pop up de Projects & SOW. Agrupa los tasks del proyecto
 * bajo su stage (por `task.stageId`), en orden de `stage.position`. Los tasks sin stage
 * (o cuyo stageId no matchea ningún stage) caen en un nodo sintético "Tasks" al final.
 * Un stage sin tasks igual aparece (con `tasks: []`).
 *
 * NOTA (dominio, 2026-09-11): los tasks que recibe son los REALES del proyecto (los
 * distintos `task` de sus horas cargadas en Zoho — ver getProjectLoggedTasks), NO los
 * task_name del scope del SOW. Esos tasks NO tienen stageId (no hay link stage↔task en
 * el schema ni en las horas), así que en la práctica TODOS caen bajo el nodo "Tasks".
 * El módulo ya soporta el nesting por si algún día se agrega un link stage↔task.
 *
 * @param {Array<{id:string|number, stageName:string, position?:number}>} stages
 * @param {Array<{id:string|number, taskName:string, stageId?:string|number|null}>} tasks
 * @returns {Array<{key:string, stageId:(string|number|null), label:string, meta:object, tasks:object[]}>}
 */
export function buildProjectTaskTree(stages = [], tasks = []) {
  // Tasks por stageId (string) — 'null' agrupa a los huérfanos.
  const byStage = new Map()
  const stageIds = new Set((stages ?? []).map((s) => String(s.id)))
  for (const t of tasks ?? []) {
    const sid = t?.stageId != null && stageIds.has(String(t.stageId)) ? String(t.stageId) : null
    if (!byStage.has(sid)) byStage.set(sid, [])
    byStage.get(sid).push(t)
  }

  const stageNodes = [...(stages ?? [])]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((s) => ({
      key: `stage-${s.id}`,
      stageId: s.id,
      label: s.stageName || '—',
      meta: s,
      tasks: byStage.get(String(s.id)) ?? [],
    }))

  const orphans = byStage.get(null) ?? []
  if (orphans.length) {
    // Nodo "Tasks": los tasks del proyecto que no están atados a un stage. Hoy TODOS
    // caen acá (no hay link stage↔task en el schema ni en las horas), así que es la
    // lista de tasks del proyecto. Si algún día se agrega el link, sólo los sueltos.
    stageNodes.push({
      key: 'no-stage',
      stageId: null,
      label: 'Tasks',
      meta: null,
      tasks: orphans,
    })
  }
  return stageNodes
}
