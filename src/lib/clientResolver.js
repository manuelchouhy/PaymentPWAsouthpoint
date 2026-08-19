/**
 * Resolución del cliente de un proyecto (slice 3, PRD entries-billing-by-client).
 *
 * En Zoho el cliente NO es un campo: es el Project Group del proyecto. La cadena
 * completa es hora → proyecto → grupo → cliente. Este módulo cubre el último
 * tramo (proyecto → cliente) y es una función pura, testeable en aislamiento.
 *
 * Orden de resolución (el manual siempre gana, decisión #6 del PRD):
 *   1. Override manual: projectClient (FK clientId → clients). El sync nunca lo
 *      escribe, así que una asignación a mano no se pisa nunca.
 *   2. Project Group de Zoho: match del nombre del grupo contra el alias del
 *      cliente (client.zohoGroupName) o, si no hay alias, contra clientName.
 *      Case-insensitive, espacios colapsados (decisión #3 y #7).
 *   3. Texto legacy del proyecto (customer_name || client): proyectos viejos del
 *      wizard/QA que no tienen client_id ni grupo. Último recurso.
 *   4. Sin cliente, con motivo: 'group-unclaimed' si el proyecto tiene grupo
 *      pero ningún cliente lo reclama; 'no-group' si no tiene grupo.
 */

export const NO_GROUP = 'no-group'
export const GROUP_UNCLAIMED = 'group-unclaimed'

/**
 * Clave de match: minúsculas, espacios colapsados, sin bordes. Absorbe el
 * "Southpoint Desk " con espacio final y variantes de tipeo, pero NO acerca
 * nombres realmente distintos ("HSS" vs "HSSStaffing") — para eso está el alias.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeClientKey(value) {
  return (value ?? '').toString().toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * @typedef {{ client: string|null, source: 'manual'|'group'|'legacy'|null, reason: null|'no-group'|'group-unclaimed' }} ClientResolution
 */

/**
 * Construye el resolvedor una vez sobre la lista de clientes y devuelve una
 * función que resuelve proyecto → cliente. Separar la construcción del uso
 * evita rearmar los índices por cada proyecto.
 *
 * @param {Array<{id?: string|number, clientName?: string, zohoGroupName?: ?string}>} clients
 * @returns {(project: object|null|undefined) => ClientResolution}
 */
export function buildClientResolver(clients = []) {
  const byId = new Map()
  // Clave normalizada (alias o nombre) → nombre canónico del cliente. Si dos
  // clientes DISTINTOS reclaman la misma clave (p. ej. uno se llama 'HSS' y otro
  // pone 'HSS' como alias de grupo), no se adivina: la clave queda null (ambigua)
  // y el proyecto cae a 'group-unclaimed'. Es la misma guarda que buildProjectIndex
  // aplica en byName; sin ella el último cliente cargado ganaba en silencio (el
  // bug de la derivación por nombre que esta cadena vino a reemplazar).
  const byKey = new Map()
  const claimKey = (key, name) => {
    if (!key || !name) return
    if (byKey.has(key) && byKey.get(key) !== name) byKey.set(key, null)
    else byKey.set(key, name)
  }
  for (const client of clients ?? []) {
    if (client?.id != null && client.clientName) {
      byId.set(String(client.id), client.clientName)
    }
    // El nombre y el alias del MISMO cliente pueden normalizar igual sin conflicto
    // (mismo nombre canónico); el alias además permite que un grupo "HSS" apunte
    // al cliente "HSSStaffing".
    if (client?.clientName) claimKey(normalizeClientKey(client.clientName), client.clientName)
    if (client?.zohoGroupName) claimKey(normalizeClientKey(client.zohoGroupName), client.clientName)
  }

  return function resolve(project) {
    if (!project) return { client: null, source: null, reason: NO_GROUP }

    // 1. Override manual.
    if (project.clientId != null) {
      const name = byId.get(String(project.clientId))
      if (name) return { client: name, source: 'manual', reason: null }
      // client_id colgado (apunta a un cliente borrado): se sigue con los
      // otros caminos en vez de devolver "sin cliente" por un FK huérfano.
    }

    // 2. Project Group.
    const group = (project.zohoProjectGroup ?? '').toString().trim()
    if (group) {
      const match = byKey.get(normalizeClientKey(group))
      if (match) return { client: match, source: 'group', reason: null }
    }

    // 3. Texto legacy (proyectos del wizard/QA sin client_id ni match de grupo).
    const legacy = project.customerName || project.client
    if (legacy) return { client: legacy, source: 'legacy', reason: null }

    // 4. Sin cliente, con el motivo que dice dónde arreglarlo.
    return { client: null, source: null, reason: group ? GROUP_UNCLAIMED : NO_GROUP }
  }
}
