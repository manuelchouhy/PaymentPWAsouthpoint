/**
 * Árbol stage → tasks para el pop up de Projects & SOW. Agrupa los tasks del proyecto
 * bajo su stage (por `task.stageId`), en orden de `stage.position`. Los tasks sin stage
 * (o cuyo stageId no matchea ningún stage) caen en un nodo sintético "Sin stage" al final.
 * Un stage sin tasks igual aparece (con `tasks: []`).
 *
 * NOTA (dominio, 2026-09-11): hoy `ProjectTask` NO tiene `stageId` en el schema (los tasks
 * son a nivel proyecto, no por stage), así que en la práctica TODOS caen bajo "Sin stage".
 * El módulo ya soporta el nesting por si se agrega el link — ver open item del slice 12.
 *
 * @param {Array<{id:string|number, stageName:string, position?:number}>} stages
 * @param {Array<{id:string|number, taskName:string, stageId?:string|number|null}>} tasks
 * @returns {Array<{key:string, stageId:(string|number|null), label:string, meta:object, tasks:object[]}>}
 */
export function buildProjectTaskTree(stages = [], tasks = []) {
  // Tasks por stageId (string) — 'null' agrupa a los huérfanos.
  const byStage = new Map()
  const stageIds = new Set(stages.map((s) => String(s.id)))
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
    stageNodes.push({
      key: 'no-stage',
      stageId: null,
      label: 'Sin stage',
      meta: null,
      tasks: orphans,
    })
  }
  return stageNodes
}
