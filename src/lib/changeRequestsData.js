/**
 * Capa de datos de Change Requests (0018_projects_client_fk_budget_allocation.sql).
 * Un CR ajusta el presupuesto pactado de un proyecto después de firmado el
 * SOW: amplía el budget (el cliente paga el excedente), absorbe un overage
 * (lo asume SouthPoint, no se factura), u otro motivo.
 *
 * @typedef {Object} ChangeRequest
 * @property {string|number} id
 * @property {string|number} projectId
 * @property {string} crNumber        autogenerado, CR-01/CR-02/... por proyecto
 * @property {'expand_budget'|'write_off_overage'|'other'} type
 * @property {number} deltaHours
 * @property {?string} reason
 * @property {?string} requestedBy
 * @property {'pending'|'approved'|'rejected'} status
 * @property {?string} decidedBy
 * @property {?string} decidedAt
 * @property {string} createdAt
 * @property {?string} createdBy
 */

import { supabase, isSupabaseConfigured } from './supabase'
import { logAudit } from './auditData'

export const CR_TYPE_LABELS = {
  expand_budget: 'Expand budget',
  write_off_overage: 'Write-off overage',
  other: 'Other',
}

/** @type {Object<string, ChangeRequest[]>} projectId -> CRs (modo demo) */
const demoChangeRequests = {}

function rowToChangeRequest(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    crNumber: row.cr_number,
    type: row.type,
    deltaHours: Number(row.delta_hours),
    reason: row.reason ?? null,
    requestedBy: row.requested_by ?? null,
    status: row.status,
    decidedBy: row.decided_by ?? null,
    decidedAt: row.decided_at ?? null,
    createdAt: row.created_at,
    createdBy: row.created_by ?? null,
  }
}

/** CR-01, CR-02, ... a partir del número más alto ya usado en el proyecto. */
function nextCrNumber(existing) {
  const highest = existing.reduce((max, cr) => {
    const n = Number(String(cr.crNumber).replace(/^CR-/i, ''))
    return Number.isFinite(n) && n > max ? n : max
  }, 0)
  return `CR-${String(highest + 1).padStart(2, '0')}`
}

/**
 * @param {string|number} projectId
 * @returns {Promise<ChangeRequest[]>} más viejo primero (CR-01, CR-02, ...).
 */
export async function getChangeRequests(projectId) {
  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 150))
    return demoChangeRequests[projectId] ?? []
  }
  const { data, error } = await supabase
    .from('change_requests')
    .select('*')
    .eq('project_id', projectId)
    .order('id', { ascending: true })
  if (error) throw new Error(error.message)
  return data.map(rowToChangeRequest)
}

/**
 * Crea un CR con el número autogenerado. El número sale de contar los que ya
 * existen, así que dos altas simultáneas pueden pedir el mismo — el índice
 * único (change_requests_project_cr_number_idx) lo rechaza y se reintenta con
 * el siguiente libre, en vez de fallarle al usuario por una carrera.
 * @param {{ projectId: string|number, type: string, deltaHours: number, reason?: ?string }} payload
 * @param {?string} createdBy
 * @returns {Promise<ChangeRequest>}
 */
export async function createChangeRequest(payload, createdBy) {
  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 200))
    const existing = demoChangeRequests[payload.projectId] ?? []
    const created = {
      id: `cr-demo-${Date.now()}`,
      projectId: payload.projectId,
      crNumber: nextCrNumber(existing),
      type: payload.type,
      deltaHours: Number(payload.deltaHours),
      reason: payload.reason ?? null,
      requestedBy: createdBy || null,
      status: 'pending',
      decidedBy: null,
      decidedAt: null,
      createdAt: new Date().toISOString(),
      createdBy: createdBy || null,
    }
    demoChangeRequests[payload.projectId] = [...existing, created]
    return created
  }

  const MAX_ATTEMPTS = 3
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const existing = await getChangeRequests(payload.projectId)
    const { data, error } = await supabase
      .from('change_requests')
      .insert({
        project_id: payload.projectId,
        cr_number: nextCrNumber(existing),
        type: payload.type,
        delta_hours: Number(payload.deltaHours),
        reason: payload.reason || null,
        requested_by: createdBy || null,
        created_by: createdBy || null,
      })
      .select()
      .single()

    if (!error) {
      const created = rowToChangeRequest(data)
      await logAudit({
        actorEmail: createdBy,
        action: 'change_request.create',
        resourceType: 'change_request',
        resourceId: created.id,
        after: { crNumber: created.crNumber, type: created.type, deltaHours: created.deltaHours },
      })
      return created
    }
    // 23505 = unique_violation: alguien tomó ese número entre el select y el
    // insert. Cualquier otro error no se reintenta, es un problema real.
    if (error.code !== '23505') throw new Error(error.message)
  }
  throw new Error('Could not assign a change request number — please try again.')
}

/**
 * Aprueba o rechaza un CR pendiente (decisión de Administrator, siempre
 * auditada). No se permite re-decidir uno ya decidido.
 * @param {string|number} id
 * @param {'approved'|'rejected'} status
 * @param {?string} decidedBy
 * @returns {Promise<ChangeRequest>}
 */
async function decideChangeRequest(id, status, decidedBy) {
  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 200))
    for (const projectId of Object.keys(demoChangeRequests)) {
      const found = demoChangeRequests[projectId].find((cr) => cr.id === id)
      if (!found) continue
      const updated = { ...found, status, decidedBy: decidedBy || null, decidedAt: new Date().toISOString() }
      demoChangeRequests[projectId] = demoChangeRequests[projectId].map((cr) => (cr.id === id ? updated : cr))
      return updated
    }
    throw new Error('Change request not found.')
  }

  // .eq('status', 'pending') además del id: si otro admin ya lo decidió entre
  // que se cargó la pantalla y este click, el update no matchea ninguna fila
  // en vez de pisar silenciosamente la decisión del otro.
  const { data, error } = await supabase
    .from('change_requests')
    .update({ status, decided_by: decidedBy || null, decided_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')
    .select()
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('This change request was already decided — reopen the project to see its current state.')

  const updated = rowToChangeRequest(data)
  await logAudit({
    actorEmail: decidedBy,
    action: `change_request.${status}`,
    resourceType: 'change_request',
    resourceId: id,
    before: { status: 'pending' },
    after: { status, crNumber: updated.crNumber, deltaHours: updated.deltaHours },
  })
  return updated
}

export function approveChangeRequest(id, decidedBy) {
  return decideChangeRequest(id, 'approved', decidedBy)
}

export function rejectChangeRequest(id, decidedBy) {
  return decideChangeRequest(id, 'rejected', decidedBy)
}

/**
 * Presupuesto vigente = base del SOW + lo aprobado que amplía budget. Los
 * write_off_overage no suman: son horas que SouthPoint absorbe, no horas
 * nuevas que el cliente autorizó.
 * @param {?number} baseBudgetHours
 * @param {ChangeRequest[]} changeRequests
 * @returns {?number} null si el proyecto no tiene presupuesto base cargado.
 */
export function effectiveBudgetHours(baseBudgetHours, changeRequests) {
  if (baseBudgetHours == null) return null
  return changeRequests
    .filter((cr) => cr.status === 'approved' && cr.type === 'expand_budget')
    .reduce((total, cr) => total + cr.deltaHours, Number(baseBudgetHours))
}
