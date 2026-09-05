import { buildClientResolver, NO_GROUP } from './clientResolver.js'

// ---------------------------------------------------------------------------
// Cliente de una entry, derivado del proyecto (cadena hora → proyecto → grupo →
// cliente, join por id de Zoho).
//
// `time_entries.client` viene del sync de Zoho y en la práctica llega vacío
// (568 de 568 filas sin cliente). Como Entries y Billing arman su columna y su
// filtro de Cliente con ese campo, el desplegable salía vacío y la columna
// mostraba "—" en todo. El dato existe un nivel más arriba: en el proyecto y su
// Project Group. Se une la hora al proyecto por id de Zoho —no por nombre— para
// que un rename o un espacio de más no deje horas huérfanas, y ante nombres
// homónimos se marca ambigüedad en vez de asignar al cliente equivocado. El
// valor propio de la entry gana si existe: si algún día Zoho lo manda, ese es el
// dato de primera mano.
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
    // truthy (no `!= null`): un zohoProjectId "" no es una llave válida y no debe
    // indexarse bajo la clave vacía.
    if (project?.zohoProjectId) byZohoId.set(String(project.zohoProjectId), project)
    const name = project?.projectName
    if (name) byName.set(name, byName.has(name) ? null : project)
  }
  return { byZohoId, byName }
}

/**
 * Proyecto de una hora. Si la hora trae `zohoProjectId` (truthy — un id "" cuenta
 * como ausente), ese es el dato autoritativo: se busca por id y, si no aparece, se
 * devuelve null. NO se cae al nombre: byZohoId y byName salen de la MISMA lista de
 * proyectos y todo proyecto trae zoho_project_id (clave del sync), así que un id
 * ausente de byZohoId significa que el proyecto no está cargado —y su nombre
 * tampoco—; el fallback sólo podría devolver OTRO proyecto homónimo, atribuyendo la
 * hora al cliente equivocado. El fallback por nombre (inequívoco; ambiguo → null
 * vía byName) es sólo para horas viejas SIN id.
 *
 * @param {{zohoProjectId?: ?(string|number), project?: string}} entry
 * @param {{ byZohoId: Map, byName: Map }} index
 * @returns {object|null}
 */
export function findProjectForEntry(entry, index) {
  if (!entry || !index) return null
  if (entry.zohoProjectId) {
    return index.byZohoId.get(String(entry.zohoProjectId)) ?? null
  }
  return index.byName.get(entry.project) ?? null
}

/**
 * Completa `client` en cada entry derivándolo del proyecto (por id → nombre) y
 * del cliente resuelto (clientResolver). El valor propio de la entry gana si
 * existe (dato de primera mano de Zoho), pero se CANONICALIZA contra la lista de
 * clientes: el sync puede mandarlo con grafía no canónica (mayúsculas/espacios/
 * alias) y, sin canonicalizar, el mismo cliente salía dos veces en el filtro (uno
 * crudo de la hora, otro canónico del proyecto). Adjunta `clientReason` (null si
 * resolvió; 'group-unclaimed' | 'no-group' si no) para que Billing pueda explicar,
 * en el bucket "Sin cliente", por qué una hora quedó sin cliente. Adjunta
 * también `projectNumber` (del proyecto unido, null si no matchea) para la
 * columna "Project #" de las grillas de Entries y Billing.
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
    // Se ubica el proyecto de la hora siempre (no sólo cuando falta el cliente):
    // la columna "Project #" de las grillas necesita el número, que vive en el
    // proyecto, no en la hora. Si la hora no matchea ningún proyecto —o el nombre
    // es ambiguo— queda null y la grilla muestra "—".
    const project = findProjectForEntry(entry, index)
    const projectNumber = project?.projectNumber ?? null
    if (entry.client) {
      // Canonicaliza el cliente propio de la hora contra la lista de clientes: si el
      // texto de Zoho nombra a un cliente cargado —con otra grafía o alias— colapsa a
      // su nombre canónico; si no matchea a nadie (o es ambiguo), se conserva tal cual.
      const canonical = resolve.canonicalizeName(entry.client)
      return { ...entry, projectNumber, client: canonical || entry.client, clientReason: null }
    }
    const resolution = project ? resolve(project) : { client: null, reason: NO_GROUP }
    return { ...entry, projectNumber, client: resolution.client ?? '', clientReason: resolution.reason ?? null }
  })
}
