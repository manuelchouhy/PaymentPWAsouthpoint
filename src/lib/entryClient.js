import { buildClientResolver, NO_GROUP } from './clientResolver.js'

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

// ---------------------------------------------------------------------------
// Cadena hora → proyecto → cliente (slice 3, join por id de Zoho)
//
// Reemplaza a buildClientByProject/withDerivedClient (arriba, por nombre de
// proyecto) una vez que el sync popule zohoProjectId en las horas y
// zohoProjectGroup en los proyectos. Se une por id de Zoho —no por nombre— para
// que un rename o un espacio de más no deje horas huérfanas, y ante nombres
// homónimos se marca ambigüedad en vez de asignar al cliente equivocado (bug del
// review sobre buildClientByProject).
// ---------------------------------------------------------------------------

/**
 * Índice de proyectos para ubicar el proyecto de una hora: por id de Zoho
 * (exacto) y por nombre (fallback). En byName, un nombre repetido guarda null
 * (ambiguo): ante dos proyectos homónimos de clientes distintos se prefiere "sin
 * cliente" antes que el cliente del último cargado.
 *
 * @param {Array<{zohoProjectId?: ?(string|number), projectName?: string}>} projects
 * @returns {{ byZohoId: Map<string, object>, byName: Map<string, object|null> }}
 */
export function buildProjectIndex(projects = []) {
  const byZohoId = new Map()
  const byName = new Map()
  for (const project of projects ?? []) {
    if (project?.zohoProjectId != null) byZohoId.set(String(project.zohoProjectId), project)
    const name = project?.projectName
    if (name) byName.set(name, byName.has(name) ? null : project)
  }
  return { byZohoId, byName }
}

/**
 * Proyecto de una hora. Si la hora trae `zohoProjectId`, ese es el dato
 * autoritativo: se busca por id y, si no aparece, devuelve null — NO se cae al
 * nombre, porque un nombre único de OTRO cliente atribuiría la hora al cliente
 * equivocado, justo lo que el join por id viene a evitar. El fallback por nombre
 * (inequívoco; ambiguo → null vía byName) es sólo para horas viejas que todavía
 * no tienen zohoProjectId.
 *
 * @param {{zohoProjectId?: ?(string|number), project?: string}} entry
 * @param {{ byZohoId: Map, byName: Map }} index
 * @returns {object|null}
 */
export function findProjectForEntry(entry, index) {
  if (!entry || !index) return null
  if (entry.zohoProjectId != null) {
    return index.byZohoId.get(String(entry.zohoProjectId)) ?? null
  }
  return index.byName.get(entry.project) ?? null
}

/**
 * Completa `client` en cada entry derivándolo del proyecto (por id → nombre) y
 * del cliente resuelto (clientResolver). El valor propio de la entry gana si
 * existe: si algún día Zoho manda el cliente en la hora, ese es dato de primera
 * mano. Adjunta también `clientReason` (null si resolvió) para que Billing pueda
 * explicar por qué una hora quedó "sin cliente".
 *
 * @param {Array<object>} entries
 * @param {Array<object>} projects
 * @param {Array<object>} clients
 * @returns {Array<object>}
 */
export function deriveEntriesClient(entries = [], projects = [], clients = []) {
  const index = buildProjectIndex(projects)
  const resolve = buildClientResolver(clients)
  return entries.map((entry) => {
    if (entry.client) return { ...entry, clientReason: null }
    const project = findProjectForEntry(entry, index)
    const resolution = project ? resolve(project) : { client: null, source: null, reason: NO_GROUP }
    return { ...entry, client: resolution.client ?? '', clientReason: resolution.reason }
  })
}
