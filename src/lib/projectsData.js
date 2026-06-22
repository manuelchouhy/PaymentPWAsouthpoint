/**
 * Capa de datos del módulo Projects & Contracts (FR-07).
 * Lee/escribe en Supabase si está configurado; si no, modo demo con mock.
 *
 * @typedef {Object} Project
 * @property {string|number} id
 * @property {string} client
 * @property {string} projectName
 * @property {string} projectNumber
 * @property {?string} customerName
 * @property {?string} customerCode
 * @property {?string} proposalName
 * @property {?string} proposalNumber
 * @property {?string} approver
 * @property {?string} customerManager
 * @property {?string} leadDeveloper
 * @property {string} contractNumber
 * @property {string} contractExpirationDate   ISO YYYY-MM-DD
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {?string} createdBy
 */

import { supabase, isSupabaseConfigured } from './supabase'

// Campos editables ↔ columnas, para mapeo y auditoría.
const FIELD_TO_COLUMN = {
  client: 'client',
  projectName: 'project_name',
  projectNumber: 'project_number',
  customerName: 'customer_name',
  customerCode: 'customer_code',
  proposalName: 'proposal_name',
  proposalNumber: 'proposal_number',
  approver: 'approver',
  customerManager: 'customer_manager',
  leadDeveloper: 'lead_developer',
  contractNumber: 'contract_number',
  contractExpirationDate: 'contract_expiration_date',
}

/** @type {Project[]} */
const MOCK_PROJECTS = [
  {
    id: 'pr-1',
    client: 'HSS',
    projectName: 'DOMO Development & IT Support',
    projectNumber: 'PRJ-1001',
    zohoStatus: 'active',
    customerName: 'Health Systems Solutions',
    customerCode: 'HSS-001',
    proposalName: 'DOMO Analytics 2026',
    proposalNumber: 'PROP-0455',
    approver: 'Karen Doyle',
    customerManager: 'Robert King',
    leadDeveloper: 'Florencia Sarasúa',
    contractNumber: 'CT-2026-014',
    contractExpirationDate: '2026-07-05',
    createdAt: '2026-01-10T10:00:00.000Z',
    updatedAt: '2026-01-10T10:00:00.000Z',
    createdBy: 'demo@southpoint.local',
  },
  {
    id: 'pr-2',
    client: 'Acme Analytics',
    projectName: 'Analytics Platform',
    projectNumber: 'PRJ-1002',
    zohoStatus: 'active',
    customerName: 'Acme Corp',
    customerCode: 'ACME-002',
    proposalName: 'Analytics Platform Rollout',
    proposalNumber: 'PROP-0461',
    approver: 'James Wu',
    customerManager: 'Paula Méndez',
    leadDeveloper: 'Matías Sarasúa',
    contractNumber: 'CT-2026-021',
    contractExpirationDate: '2026-06-25',
    createdAt: '2026-02-02T10:00:00.000Z',
    updatedAt: '2026-02-02T10:00:00.000Z',
    createdBy: 'demo@southpoint.local',
  },
  {
    id: 'pr-3',
    client: 'Southpoint (interno)',
    projectName: 'Internal Hours Allocation',
    projectNumber: 'PRJ-1003',
    zohoStatus: 'archived',
    customerName: 'Southpoint Tech Labs',
    customerCode: 'SP-000',
    proposalName: null,
    proposalNumber: null,
    approver: 'Eduardo R.',
    customerManager: 'Eduardo R.',
    leadDeveloper: 'Diego Pérez',
    contractNumber: 'CT-2025-099',
    contractExpirationDate: '2026-09-30',
    createdAt: '2025-11-15T10:00:00.000Z',
    updatedAt: '2025-11-15T10:00:00.000Z',
    createdBy: 'demo@southpoint.local',
  },
  {
    id: 'pr-zoho',
    client: 'Northwind',
    projectName: 'Northwind Data Migration',
    projectNumber: 'Z-88421',
    zohoStatus: 'active',
    customerName: null,
    customerCode: null,
    proposalName: null,
    proposalNumber: null,
    approver: null,
    customerManager: null,
    leadDeveloper: null,
    contractNumber: null, // traído de Zoho, falta completar el contrato
    contractExpirationDate: null,
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
    createdBy: 'zoho-sync',
  },
  {
    id: 'pr-4',
    client: 'HSS',
    projectName: 'Legacy ETL Maintenance',
    projectNumber: 'PRJ-0980',
    zohoStatus: 'active',
    customerName: 'Health Systems Solutions',
    customerCode: 'HSS-001',
    proposalName: 'ETL Maintenance',
    proposalNumber: 'PROP-0399',
    approver: 'Karen Doyle',
    customerManager: 'Robert King',
    leadDeveloper: 'Lucía Méndez',
    contractNumber: 'CT-2025-077',
    contractExpirationDate: '2026-05-28',
    createdAt: '2025-09-01T10:00:00.000Z',
    updatedAt: '2025-09-01T10:00:00.000Z',
    createdBy: 'demo@southpoint.local',
  },
]

// Estado demo en memoria (para que crear/editar funcione sin Supabase).
let demoProjects = MOCK_PROJECTS.map((p) => ({ ...p }))
const demoHistory = {}

function rowToProject(row) {
  return {
    id: row.id,
    client: row.client,
    projectName: row.project_name,
    projectNumber: row.project_number,
    customerName: row.customer_name ?? null,
    customerCode: row.customer_code ?? null,
    proposalName: row.proposal_name ?? null,
    proposalNumber: row.proposal_number ?? null,
    approver: row.approver ?? null,
    customerManager: row.customer_manager ?? null,
    leadDeveloper: row.lead_developer ?? null,
    contractNumber: row.contract_number,
    contractExpirationDate: row.contract_expiration_date,
    zohoStatus: row.zoho_status ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by ?? null,
  }
}

function projectToRow(project) {
  const row = {}
  for (const [field, column] of Object.entries(FIELD_TO_COLUMN)) {
    if (project[field] !== undefined) row[column] = project[field] || null
  }
  return row
}

// ---------- Helpers de estado de contrato (FR-07) ----------

/** Días entre hoy y la fecha de vencimiento (negativo = vencido). */
export function daysRemaining(expirationISO) {
  if (!expirationISO) return null
  const [y, m, d] = expirationISO.split('-').map(Number)
  if (!y || !m || !d) return null
  const exp = Date.UTC(y, m - 1, d)
  const now = new Date()
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((exp - today) / 86400000)
}

/**
 * Estado del contrato según días restantes:
 *  Expired (<0) · Critical (0-30) · Expiring Soon (31-60) ·
 *  Advance Notice (61-90) · Active (>90)
 */
export function contractStatus(days) {
  if (days == null) return 'No Contract' // proyecto de Zoho sin datos de contrato
  if (days < 0) return 'Expired'
  if (days <= 30) return 'Critical'
  if (days <= 60) return 'Expiring Soon'
  if (days <= 90) return 'Advance Notice'
  return 'Active'
}

export const CONTRACT_STATUSES = [
  'Expired',
  'Critical',
  'Expiring Soon',
  'Advance Notice',
  'Active',
  'No Contract',
]

/** Cuenta proyectos por estado de contrato. */
export function countByStatus(projects) {
  const counts = Object.fromEntries(CONTRACT_STATUSES.map((s) => [s, 0]))
  for (const p of projects) {
    counts[contractStatus(daysRemaining(p.contractExpirationDate))] += 1
  }
  return counts
}

// ---------- Configuración de alertas de contrato (FR-08) ----------

let demoAlertSettings = {
  threshold1Days: 90,
  threshold2Days: 60,
  threshold3Days: 30,
  emailRecipients: ['ops@southpoint.local'],
  emailFrequency: 'on_threshold_cross',
  updatedAt: null,
  updatedBy: null,
}

function rowToAlertSettings(row) {
  return {
    threshold1Days: row.threshold_1_days,
    threshold2Days: row.threshold_2_days,
    threshold3Days: row.threshold_3_days,
    emailRecipients: row.email_recipients ?? [],
    emailFrequency: row.email_frequency,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }
}

/** @returns {Promise<object>} configuración de alertas de contrato. */
export async function getContractAlertSettings() {
  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 150))
    return { ...demoAlertSettings }
  }
  const { data, error } = await supabase
    .from('contract_alert_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return { ...demoAlertSettings }
  return rowToAlertSettings(data)
}

/**
 * Guarda la configuración de alertas (upsert de la fila singleton id=1).
 * @param {object} settings
 * @param {?string} updatedBy
 */
export async function updateContractAlertSettings(settings, updatedBy) {
  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 250))
    demoAlertSettings = {
      ...demoAlertSettings,
      ...settings,
      updatedAt: new Date().toISOString(),
      updatedBy: updatedBy || null,
    }
    return { ...demoAlertSettings }
  }
  const { data, error } = await supabase
    .from('contract_alert_settings')
    .update({
      threshold_1_days: settings.threshold1Days,
      threshold_2_days: settings.threshold2Days,
      threshold_3_days: settings.threshold3Days,
      email_recipients: settings.emailRecipients,
      email_frequency: settings.emailFrequency,
      updated_by: updatedBy || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return rowToAlertSettings(data)
}

// ---------- CRUD ----------

/** @returns {Promise<Project[]>} ordenados por vencimiento ascendente. */
export async function getProjects() {
  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 250))
    return [...demoProjects].sort((a, b) =>
      (a.contractExpirationDate || '9999-99-99').localeCompare(
        b.contractExpirationDate || '9999-99-99',
      ),
    )
  }
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('contract_expiration_date', { ascending: true })
  if (error) throw new Error(error.message)
  return data.map(rowToProject)
}

/**
 * Crea un proyecto. Lanza un error con .code='duplicate' si el project_number
 * ya existe (para que la UI muestre un mensaje claro).
 * @param {Partial<Project>} payload
 * @param {?string} createdBy
 * @returns {Promise<Project>}
 */
export async function createProject(payload, createdBy) {
  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 300))
    if (demoProjects.some((p) => p.projectNumber === payload.projectNumber)) {
      const err = new Error('Project Number already exists.')
      err.code = 'duplicate'
      throw err
    }
    const project = {
      id: `pr-demo-${Date.now()}`,
      ...payload,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: createdBy || null,
    }
    demoProjects = [project, ...demoProjects]
    return project
  }

  const { data, error } = await supabase
    .from('projects')
    .insert({ ...projectToRow(payload), created_by: createdBy || null })
    .select()
    .single()
  if (error) {
    if (error.code === '23505') {
      const err = new Error('Project Number already exists.')
      err.code = 'duplicate'
      throw err
    }
    throw new Error(error.message)
  }
  return rowToProject(data)
}

/**
 * Actualiza un proyecto y registra en project_history una fila por cada campo
 * que cambió (capturando changed_by).
 * @param {Project} current  proyecto actual (para diff)
 * @param {Partial<Project>} updates
 * @param {?string} changedBy
 * @returns {Promise<Project>}
 */
export async function updateProject(current, updates, changedBy) {
  // Calcular qué campos cambiaron.
  const changes = []
  for (const field of Object.keys(FIELD_TO_COLUMN)) {
    if (updates[field] === undefined) continue
    const before = current[field] ?? ''
    const after = updates[field] ?? ''
    if (String(before) !== String(after)) {
      changes.push({ field, before: current[field] ?? null, after: updates[field] ?? null })
    }
  }

  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 300))
    if (
      updates.projectNumber &&
      updates.projectNumber !== current.projectNumber &&
      demoProjects.some((p) => p.projectNumber === updates.projectNumber)
    ) {
      const err = new Error('Project Number already exists.')
      err.code = 'duplicate'
      throw err
    }
    const updated = { ...current, ...updates, updatedAt: new Date().toISOString() }
    demoProjects = demoProjects.map((p) => (p.id === current.id ? updated : p))
    const log = changes.map((c, i) => ({
      id: `ph-demo-${Date.now()}-${i}`,
      fieldName: c.field,
      oldValue: c.before,
      newValue: c.after,
      changedAt: new Date().toISOString(),
      changedBy: changedBy || null,
    }))
    demoHistory[current.id] = [...log, ...(demoHistory[current.id] ?? [])]
    return updated
  }

  const { data, error } = await supabase
    .from('projects')
    .update({ ...projectToRow(updates), updated_at: new Date().toISOString() })
    .eq('id', current.id)
    .select()
    .single()
  if (error) {
    if (error.code === '23505') {
      const err = new Error('Project Number already exists.')
      err.code = 'duplicate'
      throw err
    }
    throw new Error(error.message)
  }

  if (changes.length) {
    const rows = changes.map((c) => ({
      project_id: current.id,
      field_name: c.field,
      old_value: c.before == null ? null : String(c.before),
      new_value: c.after == null ? null : String(c.after),
      changed_by: changedBy || null,
    }))
    const { error: histError } = await supabase.from('project_history').insert(rows)
    if (histError) console.warn('[projects] no se pudo registrar historial —', histError.message)
  }

  return rowToProject(data)
}

/**
 * Historial de cambios de un proyecto (más reciente primero).
 * @param {string|number} projectId
 */
export async function getProjectHistory(projectId) {
  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 150))
    return demoHistory[projectId] ?? []
  }
  const { data, error } = await supabase
    .from('project_history')
    .select('id, field_name, old_value, new_value, changed_at, changed_by')
    .eq('project_id', projectId)
    .order('changed_at', { ascending: false })
  if (error) {
    console.warn('[projects] getProjectHistory falló —', error.message)
    return []
  }
  return data.map((row) => ({
    id: row.id,
    fieldName: row.field_name,
    oldValue: row.old_value,
    newValue: row.new_value,
    changedAt: row.changed_at,
    changedBy: row.changed_by,
  }))
}
