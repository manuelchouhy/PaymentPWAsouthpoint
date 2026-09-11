/**
 * Alcance del filtro del Dashboard aplicado a TODOS los widgets, no sólo a los de
 * horas. Módulo puro (sin React ni red): predicados testeables del filtro de
 * Cliente/Proyecto.
 *
 * Decisión de producto (2026-09-11): las dimensiones **Cliente + Proyecto** (incluye
 * Project#) filtran los tiles de plata (Invoices/Collections/Payments) y los contratos
 * de proyecto. Las dimensiones **Contractor** y **Status** siguen aplicando sólo a los
 * widgets de horas (y Contractor además a Supplier Contracts, por supplierName). Los
 * Supplier Contracts NO tienen cliente en los datos, así que el filtro de Cliente no
 * los toca.
 *
 * Nota de consistencia: las FACTURAS (y por ende cobros/pagos) NO se recortan con estos
 * predicados sino por INTERSECCIÓN con sus horas ya filtradas (applyEntryFilters en la
 * página) — así comparten exactamente el criterio de las horas (mismo resolver de
 * cliente, misma semántica AND entre Proyecto y Project#). Estos predicados son para los
 * PROYECTOS/contratos, que pueden no tener horas y se matchean directo.
 */

import { clientFilterKey } from './useEntryFilters.js'

/**
 * ¿El cliente crudo pasa el filtro de clientes? Sin filtro de clientes → true. Con
 * filtro, se compara la CLAVE de filtro (clientFilterKey: nombre maestro, o el centinela
 * Others si no está en el maestro), igual criterio que la grilla de horas.
 *
 * @param {?string} rawClient  nombre de cliente ya resuelto (resolver de proyecto)
 * @param {string[]} clientKeys  filters.clients (claves de filtro elegidas)
 * @param {Set<string>} masterNames  nombres del maestro de clientes
 */
export function matchesClient(rawClient, clientKeys, masterNames) {
  if (!clientKeys?.length) return true
  return clientKeys.includes(clientFilterKey(rawClient ?? '', masterNames))
}

/**
 * ¿Un proyecto pasa el filtro Cliente/Proyecto del Dashboard? Semántica AND entre
 * dimensiones (igual que la grilla de horas): con Proyecto Y Project# activos, el
 * proyecto debe matchear AMBOS. Sin filtro en una dimensión, esa dimensión no restringe.
 *
 * El cliente se resuelve con `resolveClient` (cadena manual→grupo→legacy, el mismo
 * resolver que la grilla), no con el `projects.client` crudo, que puede venir vacío o
 * con un alias legacy.
 *
 * @param {{ projectName?: string, projectNumber?: string }} project
 * @param {{ clients?: string[], projects?: string[], projectNumbers?: string[] }} filters
 * @param {Set<string>} masterNames
 * @param {(project: object) => { client: string|null }} resolveClient
 */
export function matchesProjectFilter(project, filters, masterNames, resolveClient) {
  const rawClient = resolveClient ? (resolveClient(project)?.client ?? '') : (project?.client ?? '')
  if (!matchesClient(rawClient, filters?.clients ?? [], masterNames)) return false
  if ((filters?.projects?.length ?? 0) > 0 && !filters.projects.includes(project?.projectName)) return false
  if ((filters?.projectNumbers?.length ?? 0) > 0 && !filters.projectNumbers.includes(project?.projectNumber)) {
    return false
  }
  return true
}
