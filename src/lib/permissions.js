/**
 * Modelo de permisos por rol (FR-11).
 *
 * Roles (acumulables) provenientes de grupos de Azure AD vía role_mappings:
 *   - Operations    : leer y crear todo; editar Projects & Supplier Contracts; SIN Settings.
 *   - Finance       : leer y crear Payments; leer Collections; resto solo lectura.
 *   - Administrator : todo + Settings (roles, alertas, configuración).
 *
 * MODO SEGURO: mientras `enforcement` esté apagado (app_config.permissions_enforced=false),
 * `can()` devuelve siempre true y nada se restringe — la app funciona igual que antes.
 */

export const ROLES = {
  OPERATIONS: 'Operations',
  FINANCE: 'Finance',
  ADMIN: 'Administrator',
}

const ALL = [ROLES.OPERATIONS, ROLES.FINANCE, ROLES.ADMIN]

// Matriz acción → roles permitidos.
const MATRIX = {
  // Billing / Time entries
  'billing.view': ALL,
  'billing.create': [ROLES.OPERATIONS, ROLES.ADMIN],
  // Collections
  'collections.view': ALL,
  'collections.create': [ROLES.OPERATIONS, ROLES.ADMIN],
  // Payments al contractor
  'payments.view': ALL,
  'payments.create': [ROLES.OPERATIONS, ROLES.FINANCE, ROLES.ADMIN],
  // Clients
  'clients.view': ALL,
  'clients.create': [ROLES.OPERATIONS, ROLES.ADMIN],
  'clients.edit': [ROLES.OPERATIONS, ROLES.ADMIN],
  // Projects & Contracts
  'projects.view': ALL,
  'projects.create': [ROLES.OPERATIONS, ROLES.ADMIN],
  'projects.edit': [ROLES.OPERATIONS, ROLES.ADMIN],
  // Asignaciones de horas por proveedor/task (vive dentro de Projects and SOW)
  'assignments.view': ALL,
  'assignments.edit': [ROLES.OPERATIONS, ROLES.ADMIN],
  // Change Requests: crear lo puede Operations, pero la decisión (aprobar o
  // rechazar) queda en Administrator — mueve plata pactada con el cliente.
  'changeRequests.view': ALL,
  'changeRequests.create': [ROLES.OPERATIONS, ROLES.ADMIN],
  'changeRequests.decide': [ROLES.ADMIN],
  // Supplier Contracts
  'suppliers.view': ALL,
  'suppliers.edit': [ROLES.OPERATIONS, ROLES.ADMIN],
  // Settings (alertas, role mappings, configuración general)
  'settings.view': [ROLES.ADMIN],
  'settings.edit': [ROLES.ADMIN],
}

export function hasRole(roles, role) {
  return Array.isArray(roles) && roles.includes(role)
}

export function isAdmin(roles) {
  return hasRole(roles, ROLES.ADMIN)
}

/** ¿El usuario tiene al menos un rol con acceso a la app? (para access-denied). */
export function hasAnyRole(roles) {
  return Array.isArray(roles) && roles.length > 0
}

/**
 * ¿Puede el usuario ejecutar `action`?
 * @param {string} action  clave de la matriz (ej. 'payments.create')
 * @param {string[]} roles
 * @param {boolean} enforcement  si es false (modo seguro) => siempre true
 */
export function can(action, roles, enforcement) {
  if (!enforcement) return true
  const allowed = MATRIX[action]
  if (!allowed) return true // acción no mapeada => no se restringe
  return Array.isArray(roles) && roles.some((r) => allowed.includes(r))
}

/** Etiqueta legible de la lista de roles (para mostrar en UI). */
export function rolesLabel(roles) {
  if (!Array.isArray(roles) || roles.length === 0) return 'No role'
  return roles.join(' · ')
}
