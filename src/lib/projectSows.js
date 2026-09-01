/**
 * SOW de un proyecto — helper puro (sin dependencias de datos), para poder
 * testearlo bajo `node --test`. Vive aparte de projectsData.js justamente
 * porque ese módulo importa Supabase y no es importable en un test unitario.
 */

/**
 * Todos los SOW de un proyecto, sin duplicados: el sowNumber de proyecto más
 * los SOW de cada stage (stageSowNumbers, cargado en batch por getProjects).
 * Fuente única para las opciones del filtro, el predicado, la columna SOW y el
 * export en ProjectsPage, así los cuatro coinciden siempre.
 * @param {{ sowNumber?: ?string, stageSowNumbers?: (?string)[] }} project
 * @returns {string[]}
 */
export function projectSows(project) {
  return [
    ...new Set(
      [project.sowNumber, ...(project.stageSowNumbers ?? [])].filter(Boolean),
    ),
  ]
}

/**
 * Los sowNumber no vacíos de una lista de stages (ProjectStage[]). Fuente única
 * de la derivación stages→SOW: la usan withStageSows (refresh tras guardar) y el
 * path demo de getProjects, para que un cambio de regla (ej. normalizar el
 * string del SOW) se haga en un solo lugar.
 * @param {{ sowNumber?: ?string }[]} [stages]
 * @returns {string[]}
 */
export function stageSows(stages) {
  return (stages ?? []).map((s) => s.sowNumber).filter(Boolean)
}
