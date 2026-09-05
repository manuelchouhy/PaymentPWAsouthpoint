/**
 * Filtro "proyecto en curso" por estado de Zoho. Módulo PURO (sin imports de
 * Supabase) para poder testearlo con `node --test`, igual que paymentsGrouping.js.
 *
 * El pedido de negocio: en las vistas OPERATIVAS (el listado de Projects y, como
 * ese listado es el punto de entrada al trabajo nuevo, los flujos de trabajo nuevo)
 * sólo se ofrecen proyectos en estado Active / In Progress. On Hold, Completed y
 * archived NO se ofrecen para trabajo nuevo.
 *
 * IMPORTANTE — es un filtro de DISPLAY, no de datos: el sync sigue trayendo TODOS
 * los proyectos con su estado real (así no se congela ni se pierde nada). Las vistas
 * FINANCIERAS/HISTÓRICAS (Billing, Payments, Client Summary, Client Detail,
 * Traceability, Audit Log) NO deben usar este filtro, para no esconder un proyecto
 * Completed que tiene horas/facturas/pagos.
 */

// Estados de Zoho (normalizados a minúsculas) considerados "en curso".
export const ACTIVE_PROJECT_STATUSES = ['active', 'in progress']

/**
 * ¿El proyecto se ofrece en vistas operativas?
 *
 * Los proyectos creados en la app (sin `zohoProjectId`) SIEMPRE se muestran: el
 * pedido es sobre lo que TRAE Zoho, y esos manuales llegan con `zohoStatus` null —
 * un allow-list crudo los escondería apenas se crean. Un proyecto de Zoho (con
 * `zohoProjectId`) se muestra sólo si su estado es Active / In Progress. La
 * comparación se normaliza (minúsculas + espacios colapsados) porque Zoho manda
 * 'Active'/'In Progress' pero el mock/legacy usa 'active'.
 *
 * @param {{zohoProjectId?: any, zohoStatus?: ?string}} project
 * @returns {boolean}
 */
export function isActiveProject(project) {
  if (!project) return false
  // No vino de Zoho (proyecto manual) → este criterio no lo filtra. Se usa un chequeo
  // truthy (no `!= null`): un zoho_project_id '' no es una llave válida y cuenta como
  // ausente, igual que en buildProjectIndex/findProjectForEntry (entryClient.js).
  if (!project.zohoProjectId) return true
  const status = String(project.zohoStatus ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
  return ACTIVE_PROJECT_STATUSES.includes(status)
}
