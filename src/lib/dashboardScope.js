/**
 * Alcance del filtro del Dashboard aplicado a TODOS los widgets, no sólo a los de
 * horas. Módulo puro (sin React ni red): predicados testeables que deciden si una
 * factura / proyecto / cobro / pago cae dentro del filtro de Cliente/Proyecto.
 *
 * Decisión de producto (2026-09-11): las dimensiones **Cliente + Proyecto** (incluye
 * Project#) filtran los tiles de plata (Invoices/Collections/Payments) y los contratos
 * de proyecto. Las dimensiones **Contractor** y **Status** siguen aplicando sólo a los
 * widgets de horas (y Contractor además a Supplier Contracts, por supplierName). Los
 * Supplier Contracts NO tienen cliente en los datos, así que el filtro de Cliente no
 * los toca.
 */

import { clientFilterKey } from './useEntryFilters.js'

/**
 * Nombres de proyecto permitidos por el filtro: los elegidos en `projects` MÁS los
 * nombres de los `projectNumbers` elegidos (resueltos contra la lista de proyectos, ya
 * que facturas/cobros/pagos guardan el NOMBRE del proyecto, no su número). `null` = sin
 * restricción de proyecto (ninguna de las dos dimensiones activa), para distinguir "sin
 * filtro" de "filtro que no matchea nada" (un Set vacío).
 *
 * @param {{ projects?: string[], projectNumbers?: string[] }} filters
 * @param {Array<{ projectName?: string, projectNumber?: string }>} projects
 * @returns {Set<string>|null}
 */
export function allowedProjectNames(filters, projects) {
  const hasProjects = (filters?.projects?.length ?? 0) > 0
  const hasNumbers = (filters?.projectNumbers?.length ?? 0) > 0
  if (!hasProjects && !hasNumbers) return null
  const set = new Set(filters.projects ?? [])
  if (hasNumbers) {
    for (const p of projects ?? []) {
      if (filters.projectNumbers.includes(p.projectNumber)) set.add(p.projectName)
    }
  }
  return set
}

/**
 * ¿El cliente crudo pasa el filtro de clientes? Sin filtro de clientes → true. Con
 * filtro, se compara la CLAVE de filtro (clientFilterKey: nombre maestro, o el centinela
 * Others si no está en el maestro), igual criterio que la grilla de horas.
 *
 * @param {?string} rawClient  nombre de cliente ya resuelto (invoice.client / resolver)
 * @param {string[]} clientKeys  filters.clients (claves de filtro elegidas)
 * @param {Set<string>} masterNames  nombres del maestro de clientes
 */
export function matchesClient(rawClient, clientKeys, masterNames) {
  if (!clientKeys?.length) return true
  return clientKeys.includes(clientFilterKey(rawClient ?? '', masterNames))
}

/**
 * ¿El nombre de proyecto pasa la restricción de proyecto? `allowed === null` (sin
 * filtro de proyecto) → true.
 *
 * @param {?string} projectName
 * @param {Set<string>|null} allowed  salida de allowedProjectNames
 */
export function matchesProjectName(projectName, allowed) {
  return allowed == null || allowed.has(projectName ?? '')
}
