/**
 * Árbol stage → tasks para el pop up de Projects & SOW. Agrupa los tasks del proyecto
 * bajo su stage (por `task.stageId`), en orden de `stage.position`. Los tasks sin stage
 * (o cuyo stageId no matchea ningún stage) caen en un nodo sintético "Tasks" al final.
 * Un stage sin tasks igual aparece (con `tasks: []`).
 *
 * NOTA (dominio, 2026-09-11): los tasks que recibe son el MERGE de los registrados del SOW
 * (project_tasks, con su `stageId` asignado) y los logueados de las horas de Zoho (ver
 * mergeProjectTasks). Los que tienen stageId caen bajo su stage; los que no (logueados sin
 * registrar, o registrados sin asignar) caen bajo el nodo "No stage".
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
    // Nodo "No stage": los tasks que no están asignados a ningún stage — registrados sin
    // asignar, o logueados sin registrar (ver mergeProjectTasks). Los que sí tienen stage
    // caen bajo el suyo.
    stageNodes.push({
      key: 'no-stage',
      stageId: null,
      label: 'No stage',
      meta: null,
      tasks: orphans,
    })
  }
  return stageNodes
}
