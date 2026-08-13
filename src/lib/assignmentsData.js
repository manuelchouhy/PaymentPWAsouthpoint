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
import { getTimeEntries } from './data'

const FIELD_TO_COLUMN = {
  // projectId estaba faltando: provider_assignments.project_id es NOT NULL
  // (0019), así que sin esta entrada el insert lo omitía y Postgres lo
  // rechazaba. No se notaba porque el modo demo hace spread del payload en
  // vez de mapear columnas, y hasta ahora nadie consumía este módulo.
  projectId: 'project_id',
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
 * Nombres de proveedor asignables: los distintos `user_name` que ya
 * existen en time_entries. No se acotan a este proyecto a propósito — lo
 * normal es autorizar horas a alguien *antes* de que cargue la primera en
 * este proyecto. Es una lista cerrada (no texto libre) para que un typo no
 * genere una asignación huérfana que nunca matchee con sus horas.
 * @returns {Promise<string[]>} ordenados alfabéticamente.
 */
export async function getProviderNames() {
  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 150))
    // De los time entries demo, no de demoAssignments: la lista es "quién
    // cargó horas alguna vez", no "a quién ya le asignamos" (si no, el primer
    // alta de un proyecto nunca tendría a nadie para elegir).
    const entries = await getTimeEntries()
    return [...new Set(entries.map((e) => e.user).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'))
  }
  // Solo la columna que se necesita y con tope: time_entries es la tabla más
  // grande de la app (miles de filas) y esto alimenta un dropdown.
  const { data, error } = await supabase
    .from('time_entries')
    .select('user_name')
    .order('user_name', { ascending: true })
    .limit(5000)
  if (error) throw new Error(error.message)
  return [...new Set((data ?? []).map((r) => r.user_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'))
}

/**
 * Tasks asignables de un proyecto: los distintos `task` que aparecen en sus
 * time_entries, NO los task_name del SOW.
 *
 * Suena contraintuitivo, pero es lo único que funciona: las horas consumidas
 * se cruzan matcheando ese texto (no hay FK entre time_entries y
 * project_tasks), y el texto lo escribe el contractor en Zoho. Si el
 * dropdown ofreciera "Backend Development" del SOW y en Zoho dice "Backend",
 * consumed daría 0 siempre y nunca se detectaría un overage — justo lo que
 * esta pantalla existe para mostrar.
 * @param {string} projectName
 * @returns {Promise<string[]>} ordenados alfabéticamente.
 */
export async function getProjectTaskNames(projectName) {
  if (!isSupabaseConfigured) {
    const entries = await getTimeEntries()
    return [...new Set(entries.filter((e) => e.project === projectName).map((e) => e.task).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b, 'es'),
    )
  }
  if (!projectName) return []
  const { data, error } = await supabase.from('time_entries').select('task').eq('project', projectName).limit(5000)
  if (error) throw new Error(error.message)
  return [...new Set((data ?? []).map((r) => r.task).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'))
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
