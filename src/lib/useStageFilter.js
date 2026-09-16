import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './api'
import { buildTaskToStage } from './stageHourAttribution'
import { buildStageOptions } from './stageFilterOptions'
import { normalizeTaskToStage } from './stageFilter'

/**
 * Hook reusable del Filtro de Stage (ver "Filtro de Stage" en CONTEXT.md). Centraliza lo
 * que compartían Billing y las demás páginas: carga de stages + membresía, estado de la
 * selección, catálogo con prefijo de proyecto, y la construcción de opciones interlazadas.
 *
 * La APLICACIÓN del filtro NO vive acá (difiere por página): las páginas de horas usan
 * `filterEntriesByStage` con `taskToStage`; Projects usa `projectMatchesStages`; Client
 * Summary lo pasa a su motor. El hook sólo provee los datos y las opciones.
 *
 * Cada carga tiene su propio catch: un fallo deja la página SIN filtro de stage (catálogo
 * vacío → el dropdown no se muestra), nunca tira la pantalla — mismo criterio que Billing.
 *
 * @param {{ withMembership?: boolean, projects?: Array<{id:(string|number), projectNumber?:string}>,
 *           reloadKey?: * }} [opts]
 *   - withMembership: si true, carga la membresía task→stage (páginas de horas y Client
 *     Summary). Projects no la necesita (filtra por fila de proyecto) → false.
 *   - projects: para resolver projectId→projectNumber en el rótulo. Sin esto, el prefijo cae
 *     al projectId.
 *   - reloadKey: cambia cuando la página recarga tras un sync (useSyncReload). Al cambiar, el
 *     hook re-trae stages y membresía, para no quedar con un mapa task→stage viejo que filtraría
 *     de más las horas recién sincronizadas (mismo criterio que el resto de los datos de la página).
 */
export function useStageFilter({ withMembership = false, projects = [], reloadKey } = {}) {
  const [stagesByProject, setStagesByProject] = useState(() => new Map())
  const [membership, setMembership] = useState([])
  const [selectedStageIds, setSelectedStageIds] = useState(() => new Set())

  useEffect(() => {
    let cancelled = false
    // Promise.resolve().then(() => api...()) para que un throw SÍNCRONO del data-layer (p. ej.
    // notImplemented() del http-client, que tira al invocarse) se convierta en un rechazo
    // atrapable por .catch, en vez de escapar del efecto y tumbar el commit de React.
    Promise.resolve()
      .then(() => api.projects.getAllStages())
      .then((map) => { if (!cancelled) setStagesByProject(map ?? new Map()) })
      .catch((error) => console.error('No se pudieron cargar los stages:', error))
    if (withMembership) {
      Promise.resolve()
        .then(() => api.projects.getStageMembership())
        .then((rows) => { if (!cancelled) setMembership(rows ?? []) })
        .catch((error) => console.error('No se pudo cargar la membresía de stages:', error))
    }
    return () => { cancelled = true }
  }, [withMembership, reloadKey])

  // projectId → projectNumber (para el prefijo del rótulo).
  const projectNumberById = useMemo(() => {
    const m = new Map()
    for (const p of projects ?? []) {
      if (p?.id != null) m.set(String(p.id), p.projectNumber ?? null)
    }
    return m
  }, [projects])

  // Catálogo stage_id → { name, projectId, projectNumber }, desde stagesByProject.
  const catalog = useMemo(() => {
    const m = new Map()
    for (const [pid, stages] of stagesByProject) {
      for (const s of stages ?? []) {
        m.set(String(s.id), {
          name: s.name ?? `Stage ${s.id}`,
          projectId: String(pid),
          projectNumber: projectNumberById.get(String(pid)) ?? null,
        })
      }
    }
    return m
  }, [stagesByProject, projectNumberById])

  const taskToStage = useMemo(() => buildTaskToStage(membership), [membership])
  // Lookup normalizado (Map<string,string>) compartido con filterEntriesByStage: se arma UNA
  // vez por cambio de membresía y lo reusan stageOfEntry (acá) y el filtro de horas.
  const stageByTask = useMemo(() => normalizeTaskToStage(taskToStage), [taskToStage])

  const stageOfEntry = useCallback(
    (entry) => stageByTask.get(String(entry?.taskNumber ?? '')) ?? null,
    [stageByTask],
  )

  const toggleStage = useCallback((sid) => {
    setSelectedStageIds((prev) => {
      const next = new Set(prev)
      const k = String(sid)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }, [])

  const clearStages = useCallback(() => setSelectedStageIds(new Set()), [])

  // Opciones interlazadas: el caller pasa los stage_id presentes en el scope (lo que pasa
  // los otros filtros). Devuelve { optionIds, getLabel } vía el módulo puro.
  const buildOptions = useCallback(
    (presentStageIds) =>
      buildStageOptions({ presentStageIds, selectedIds: [...selectedStageIds], catalog }),
    [selectedStageIds, catalog],
  )

  return {
    selectedStageIds,
    stageFilterActive: selectedStageIds.size > 0,
    toggleStage,
    clearStages,
    taskToStage,
    catalog,
    stagesByProject,
    stageOfEntry,
    buildOptions,
  }
}
