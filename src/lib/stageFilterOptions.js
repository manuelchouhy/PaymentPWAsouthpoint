/**
 * Opciones y rótulo del Filtro de Stage (módulo puro, sin React ni red). Encapsula dos
 * decisiones del dominio (ver "Filtro de Stage" en CONTEXT.md):
 *  - INTERLAZADO: las opciones son los stages presentes en scope (los que pasan los otros
 *    filtros) UNIDOS a los ya seleccionados, para no perder una selección que el cruce dejó
 *    fuera de scope (si no, un stage tildado sin horas desaparecería y no se podría destildar).
 *  - RÓTULO con PREFIJO CONDICIONAL: cuando las opciones abarcan más de un proyecto se
 *    prefija con el número de proyecto (`PP1 · Stage 1`) para des-ambiguar stages homónimos;
 *    cuando caen todas en un único proyecto el prefijo se cae (`Stage 1`).
 */

const coll = (a, b) => (a ?? '').localeCompare(b ?? '', 'es', { numeric: true })

function nameOf(catalog, sid) {
  return catalog.get(String(sid))?.name ?? `Stage ${sid}`
}

/**
 * @param {{ presentStageIds?: Iterable<(string|number)>,
 *           selectedIds?: Iterable<(string|number)>,
 *           catalog: Map<string,{name?:string, projectId?:string, projectNumber?:string}> }} input
 * @returns {{ optionIds: string[], getLabel: (sid:(string|number)) => string }}
 */
export function buildStageOptions({ presentStageIds = [], selectedIds = [], catalog = new Map() }) {
  const ids = new Set()
  for (const id of selectedIds) ids.add(String(id))
  for (const id of presentStageIds) {
    const k = String(id)
    if (catalog.has(k)) ids.add(k)
  }
  const optionIds = [...ids].sort((a, b) => coll(nameOf(catalog, a), nameOf(catalog, b)))

  // ¿Las opciones abarcan más de un proyecto? Decide el prefijo del rótulo.
  const projectIds = new Set()
  for (const sid of optionIds) {
    const pid = catalog.get(sid)?.projectId
    if (pid != null) projectIds.add(String(pid))
  }
  const multiProject = projectIds.size > 1

  const getLabel = (sid) => {
    const entry = catalog.get(String(sid))
    const name = entry?.name ?? `Stage ${sid}`
    if (!multiProject) return name
    const prefix = entry?.projectNumber ?? entry?.projectId
    return prefix ? `${prefix} · ${name}` : name
  }

  return { optionIds, getLabel }
}
