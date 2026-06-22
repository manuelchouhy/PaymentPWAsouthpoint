import { supabase, isSupabaseConfigured } from './supabase'

/**
 * Registra una acción crítica en audit_log. Fire-and-forget: nunca bloquea
 * el flujo de la UI y falla silenciosamente si Supabase no está configurado.
 */
export async function logAudit({
  actorEmail,
  actorRole = null,
  action,
  resourceType = null,
  resourceId = null,
  before = null,
  after = null,
}) {
  if (!isSupabaseConfigured || !actorEmail) return
  const { error } = await supabase.from('audit_log').insert({
    actor_email: actorEmail,
    actor_role: actorRole,
    action,
    resource_type: resourceType,
    resource_id: resourceId ?? null,
    before_data: before ?? null,
    after_data: after ?? null,
  })
  if (error) console.warn('[audit] Failed to log action:', action, error.message)
}

export async function getAuditLog({
  action,
  resourceType,
  dateFrom,
  dateTo,
  search,
} = {}) {
  if (!isSupabaseConfigured) return []

  let query = supabase
    .from('audit_log')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(1000)

  if (action) query = query.eq('action', action)
  if (resourceType) query = query.eq('resource_type', resourceType)
  if (dateFrom) query = query.gte('timestamp', dateFrom + 'T00:00:00Z')
  if (dateTo) query = query.lte('timestamp', dateTo + 'T23:59:59Z')

  const { data, error } = await query
  if (error) throw new Error(error.message)

  let rows = data.map((r) => ({
    id: r.id,
    actorEmail: r.actor_email,
    actorRole: r.actor_role,
    action: r.action,
    resourceType: r.resource_type,
    resourceId: r.resource_id,
    before: r.before_data,
    after: r.after_data,
    timestamp: r.timestamp,
  }))

  if (search) {
    const q = search.toLowerCase()
    rows = rows.filter(
      (r) =>
        r.actorEmail.toLowerCase().includes(q) ||
        r.action.toLowerCase().includes(q) ||
        (r.resourceType ?? '').toLowerCase().includes(q),
    )
  }

  return rows
}
