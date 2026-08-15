/**
 * Cliente de una entry, derivado del proyecto.
 *
 * `time_entries.client` viene del sync de Zoho y en la práctica llega vacío:
 * hoy son 568 de 568 filas sin cliente. Como Entries y Billing arman su
 * columna y su filtro de Cliente con ese campo, el desplegable salía vacío y la
 * columna mostraba "—" en todo, incluso para clientes dados de alta en la app.
 *
 * El dato sí existe, pero un nivel más arriba: en el proyecto. Se toma de ahí
 * cuando la entry no lo trae, con el mismo criterio que Client Summary y Client
 * Detail — `customerName` (nombre comercial que trae Zoho) y, si no está, el
 * `client` que escribe el wizard al elegir un cliente de la tabla clients.
 *
 * El valor propio de la entry gana si existe: si algún día Zoho empieza a
 * mandarlo, ese es el dato de primera mano.
 */

/**
 * @param {Array<{projectName?: string, customerName?: ?string, client?: ?string}>} projects
 * @returns {Map<string, string>} nombre de proyecto -> nombre de cliente
 */
export function buildClientByProject(projects) {
  const map = new Map()
  for (const project of projects ?? []) {
    const name = project.customerName || project.client || ''
    if (project.projectName && name) map.set(project.projectName, name)
  }
  return map
}

/**
 * Devuelve las entries con `client` completado desde el proyecto cuando venían
 * sin él. Se resuelve una sola vez, antes de filtrar y de renderizar, para que
 * el filtro, las opciones del desplegable y la columna hablen todos del mismo
 * valor sin tocar applyEntryFilters.
 *
 * @param {Array<object>} entries
 * @param {Map<string, string>} clientByProject
 * @returns {Array<object>}
 */
export function withDerivedClient(entries, clientByProject) {
  if (!clientByProject?.size) return entries
  return entries.map((entry) =>
    entry.client ? entry : { ...entry, client: clientByProject.get(entry.project) ?? '' },
  )
}
