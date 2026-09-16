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
  const all = [...ids]

  // ¿El SCOPE abarca más de un proyecto? Decide el prefijo del rótulo Y el orden. Se mide sobre
  // los stages PRESENTES (los que pasan los otros filtros), NO sobre la unión con los
  // seleccionados: un stage seleccionado que quedó fuera de scope (p. ej. tras filtrar a un
  // único proyecto) no debe reactivar el prefijo — la regla es "scope de un proyecto → sin
  // prefijo" (ver "Filtro de Stage" en CONTEXT.md).
  const projectIds = new Set()
  for (const id of presentStageIds) {
    const pid = catalog.get(String(id))?.projectId
    if (pid != null) projectIds.add(String(pid))
  }
  const multiProject = projectIds.size > 1

  const prefixOf = (sid) => {
    const e = catalog.get(String(sid))
    return e?.projectNumber ?? e?.projectId ?? ''
  }
  // En modo multi-proyecto el orden agrupa por proyecto (mismo criterio que el prefijo del
  // rótulo) y desempata por nombre; si no, sólo por nombre.
  const optionIds = all.sort((a, b) => {
    if (multiProject) {
      const byProject = coll(prefixOf(a), prefixOf(b))
      if (byProject !== 0) return byProject
    }
    return coll(nameOf(catalog, a), nameOf(catalog, b))
  })

  const getLabel = (sid) => {
    const entry = catalog.get(String(sid))
    const name = entry?.name ?? `Stage ${sid}`
    if (!multiProject) return name
    const prefix = entry?.projectNumber ?? entry?.projectId
    return prefix ? `${prefix} · ${name}` : name
  }

  return { optionIds, getLabel }
}
