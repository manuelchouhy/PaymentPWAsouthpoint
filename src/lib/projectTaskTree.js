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
 * Además del `stageId` del SOW (por nombre), se acepta un mapa `taskToStage` (zoho_task_id →
 * stage_id, de la tabla stage_task_membership): un task LOGUEADO sin stage asignado pero cuyo
 * `taskNumber` (id de Zoho) está en la membresía cae bajo ESE stage. Así los proyectos que no
 * tienen project_tasks del SOW (los sincronizados de Zoho) igual muestran sus tasks agrupados
 * por stage, no todos bajo "No stage". El `stageId` explícito del SOW tiene prioridad.
 *
 * @param {Array<{id:string|number, stageName:string, position?:number}>} stages
 * @param {Array<{id:string|number, taskName:string, stageId?:string|number|null, taskNumber?:string|number|null}>} tasks
 * @param {Record<string, string|number>} [taskToStage]  zoho_task_id → stage_id (membresía)
 * @returns {Array<{key:string, stageId:(string|number|null), label:string, meta:object, tasks:object[]}>}
 */
export function buildProjectTaskTree(stages = [], tasks = [], taskToStage = {}) {
  // Tasks por stageId (string) — 'null' agrupa a los huérfanos.
  const byStage = new Map()
  const stageIds = new Set((stages ?? []).map((s) => String(s.id)))
  for (const t of tasks ?? []) {
    let sid = t?.stageId != null && stageIds.has(String(t.stageId)) ? String(t.stageId) : null
    // Fallback por membresía de Zoho: si no tiene stage del SOW pero su taskNumber está en la
    // membresía, usar ese stage (siempre que sea un stage real de este proyecto).
    if (sid == null && t?.taskNumber != null) {
      const fromMembership = taskToStage?.[String(t.taskNumber)]
      if (fromMembership != null && stageIds.has(String(fromMembership))) sid = String(fromMembership)
    }
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
