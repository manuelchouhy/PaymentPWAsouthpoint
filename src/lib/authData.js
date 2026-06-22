/**
 * Capa de datos de autenticación / roles (FR-11).
 * JIT provisioning + lectura de configuración y mapeos de roles.
 */
import { supabase, isSupabaseConfigured } from './supabase'

/**
 * JIT provisioning: registra/actualiza al usuario actual a partir del JWT
 * verificado (server-side, vía la función SECURITY DEFINER provision_current_user).
 * Devuelve el perfil con sus roles efectivos.
 */
export async function provisionCurrentUser() {
  if (!isSupabaseConfigured) {
    return {
      id: 'demo',
      email: 'demo@southpoint.local',
      fullName: 'Demo',
      upn: 'demo@southpoint.local',
      roles: ['Administrator'],
      isActive: true,
    }
  }
  const { data, error } = await supabase.rpc('provision_current_user')
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : data
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    upn: row.upn,
    roles: row.roles ?? [],
    isActive: row.is_active,
    azureOid: row.azure_oid,
    lastLoginAt: row.last_login_at,
  }
}

const DEFAULT_CONFIG = {
  permissionsEnforced: false,
  sessionMaxHours: 8,
  adminBootstrapEmail: null,
}

export async function getAppConfig() {
  if (!isSupabaseConfigured) return { ...DEFAULT_CONFIG }
  const { data, error } = await supabase
    .from('app_config')
    .select('*')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return { ...DEFAULT_CONFIG }
  return {
    permissionsEnforced: data.permissions_enforced,
    sessionMaxHours: data.session_max_hours,
    adminBootstrapEmail: data.admin_bootstrap_email,
  }
}

export async function updateAppConfig({ permissionsEnforced, sessionMaxHours }, updatedBy) {
  const { data, error } = await supabase
    .from('app_config')
    .update({
      permissions_enforced: permissionsEnforced,
      session_max_hours: sessionMaxHours,
      updated_by: updatedBy ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return {
    permissionsEnforced: data.permissions_enforced,
    sessionMaxHours: data.session_max_hours,
    adminBootstrapEmail: data.admin_bootstrap_email,
  }
}

function rowToMapping(r) {
  return {
    id: r.id,
    azureGroupName: r.azure_group_name,
    roleName: r.role_name,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  }
}

export async function getRoleMappings() {
  if (!isSupabaseConfigured) {
    return [
      { id: 1, azureGroupName: 'Contractors-Operations', roleName: 'Operations' },
      { id: 2, azureGroupName: 'Contractors-Finance', roleName: 'Finance' },
      { id: 3, azureGroupName: 'Contractors-Admin', roleName: 'Administrator' },
    ]
  }
  const { data, error } = await supabase
    .from('role_mappings')
    .select('*')
    .order('azure_group_name')
  if (error) throw new Error(error.message)
  return data.map(rowToMapping)
}

export async function upsertRoleMapping({ id, azureGroupName, roleName }, updatedBy) {
  if (id) {
    const { error } = await supabase
      .from('role_mappings')
      .update({
        azure_group_name: azureGroupName,
        role_name: roleName,
        updated_by: updatedBy ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (error) throw new Error(error.message)
  } else {
    const { error } = await supabase
      .from('role_mappings')
      .insert({ azure_group_name: azureGroupName, role_name: roleName, updated_by: updatedBy ?? null })
    if (error) throw new Error(error.message)
  }
}

export async function listUsers() {
  if (!isSupabaseConfigured) return []
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .order('last_login_at', { ascending: false, nullsFirst: false })
  if (error) throw new Error(error.message)
  return data.map((u) => ({
    id: u.id,
    email: u.email,
    fullName: u.full_name,
    roles: u.roles ?? [],
    isActive: u.is_active,
    lastLoginAt: u.last_login_at,
    firstLoginAt: u.first_login_at,
  }))
}
