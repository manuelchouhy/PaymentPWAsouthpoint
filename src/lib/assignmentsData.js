/**
 * Capa de datos de Asignaciones (horas autorizadas por proveedor/task en un
 * proyecto). La UI vive dentro de Projects and SOW — este módulo solo expone
 * el CRUD + el cálculo de consumida/restante contra time_entries.
 *
 * @typedef {Object} ProviderAssignment
 * @property {string|number} id
 * @property {string|number} projectId
 * @property {string} taskName
 * @property {string} providerName
 * @property {number} authorizedHours
 * @property {number} consumedHours   calculado, no se guarda
 * @property {number} remainingHours  calculado, no se guarda
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {?string} createdBy
 */

import { supabase, isSupabaseConfigured } from './supabase'
import { logAudit } from './auditData'

const FIELD_TO_COLUMN = {
  taskName: 'task_name',
  providerName: 'provider_name',
  authorizedHours: 'authorized_hours',
}

/** @type {ProviderAssignment[]} */
let demoAssignments = [
  {
    id: 'pa-demo-1',
    projectId: 'demo-project-1',
    taskName: 'Backend',
    providerName: 'María Rodríguez',
    authorizedHours: 220,
    createdAt: '2026-03-01T10:00:00.000Z',
    updatedAt: '2026-03-01T10:00:00.000Z',
    createdBy: 'demo@southpoint.local',
  },
]

function rowToAssignment(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    taskName: row.task_name,
    providerName: row.provider_name,
    authorizedHours: Number(row.authorized_hours),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by ?? null,
  }
}

function assignmentToRow(assignment) {
  const row = {}
  for (const [field, column] of Object.entries(FIELD_TO_COLUMN)) {
    if (assignment[field] !== undefined) row[column] = assignment[field]
  }
  return row
}

/**
 * Horas consumidas por proveedor/task: suma de time_entries Approved que
 * matchean por nombre de proyecto + task + proveedor (mismo esquema de
 * matcheo por texto que usa el resto de la app, no hay FK entre las tablas).
 * @param {string} projectName
 * @returns {Promise<Map<string, number>>} clave `${taskName}::${providerName}`
 */
async function getConsumedHoursByProject(projectName) {
  if (!isSupabaseConfigured || !projectName) return new Map()
  const { data, error } = await supabase
    .from('time_entries')
    .select('task, user_name, hours')
    .eq('project', projectName)
    .eq('status', 'Approved')
  if (error) throw new Error(error.message)

  const totals = new Map()
  for (const row of data) {
    const key = `${row.task ?? ''}::${row.user_name}`
    totals.set(key, (totals.get(key) ?? 0) + Number(row.hours))
  }
  return totals
}

/**
 * @param {{ id: string|number, projectName: string }} project
 * @returns {Promise<ProviderAssignment[]>}
 */
export async function getAssignments(project) {
  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 200))
    return demoAssignments
      .filter((a) => a.projectId === project.id)
      .map((a) => ({ ...a, consumedHours: 0, remainingHours: a.authorizedHours }))
  }

  const [{ data, error }, consumed] = await Promise.all([
    supabase
      .from('provider_assignments')
      .select('*')
      .eq('project_id', project.id)
      .order('provider_name', { ascending: true }),
    getConsumedHoursByProject(project.projectName),
  ])
  if (error) throw new Error(error.message)

  return data.map((row) => {
    const assignment = rowToAssignment(row)
    const consumedHours = consumed.get(`${assignment.taskName}::${assignment.providerName}`) ?? 0
    return {
      ...assignment,
      consumedHours,
      remainingHours: assignment.authorizedHours - consumedHours,
    }
  })
}

/**
 * @param {Partial<ProviderAssignment>} payload
 * @param {?string} createdBy
 * @returns {Promise<ProviderAssignment>}
 */
export async function createAssignment(payload, createdBy) {
  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 200))
    const assignment = {
      id: `pa-demo-${Date.now()}`,
      ...payload,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: createdBy || null,
    }
    demoAssignments = [assignment, ...demoAssignments]
    return assignment
  }

  const { data, error } = await supabase
    .from('provider_assignments')
    .insert({ ...assignmentToRow(payload), created_by: createdBy || null })
    .select()
    .single()
  if (error) throw new Error(error.message)

  await logAudit({
    actorEmail: createdBy,
    action: 'assignment.create',
    resourceType: 'provider_assignment',
    resourceId: data.id,
    after: assignmentToRow(payload),
  })
  return rowToAssignment(data)
}

/**
 * Amplía/edita la autorización de un proveedor. Acción explícita del PM
 * ("Ampliar una asignación"), siempre auditada.
 * @param {string|number} id
 * @param {number} authorizedHours
 * @param {?string} updatedBy
 * @returns {Promise<ProviderAssignment>}
 */
export async function updateAssignmentHours(id, authorizedHours, updatedBy) {
  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 200))
    demoAssignments = demoAssignments.map((a) =>
      a.id === id ? { ...a, authorizedHours, updatedAt: new Date().toISOString() } : a,
    )
    return demoAssignments.find((a) => a.id === id)
  }

  const { data: before, error: beforeError } = await supabase
    .from('provider_assignments')
    .select('*')
    .eq('id', id)
    .single()
  if (beforeError) throw new Error(beforeError.message)

  const { data, error } = await supabase
    .from('provider_assignments')
    .update({ authorized_hours: authorizedHours })
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(error.message)

  await logAudit({
    actorEmail: updatedBy,
    action: 'assignment.update_hours',
    resourceType: 'provider_assignment',
    resourceId: id,
    before: { authorizedHours: Number(before.authorized_hours) },
    after: { authorizedHours },
  })
  return rowToAssignment(data)
}
