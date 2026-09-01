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
