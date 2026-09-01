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
import { demoDate } from './demoDates'

// Campos editables ↔ columnas, para mapeo y auditoría.
const FIELD_TO_COLUMN = {
  client: 'client',
  clientId: 'client_id',
  baseBudgetHours: 'base_budget_hours',
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
  // Wizard de Projects and SOW (Fase 4a-4d) — faltaban, el alta del wizard
  // los mandaba pero se perdían silenciosamente antes de este fix.
  sowNumber: 'sow_number',
  sowUrl: 'sow_url',
  hasStages: 'has_stages',
  stageName: 'stage_name',
  model: 'model',
  periodStart: 'period_start',
  periodEnd: 'period_end',
  maintenanceEnabled: 'maintenance_enabled',
  slaTemplate: 'sla_template',
  maintenanceTransition: 'maintenance_transition',
  maintenanceHoursPool: 'maintenance_hours_pool',
  maintenanceDurationMonths: 'maintenance_duration_months',
  maintenanceSlaTiers: 'maintenance_sla_tiers',
}

/** @type {Project[]} */
const MOCK_PROJECTS = [
  {
    id: 'pr-1',
    client: 'HSS',
    projectName: 'DOMO Development & IT Support',
    projectNumber: 'PRJ-1001',
    sowNumber: 'SOW-2041',
    baseBudgetHours: 620,
    periodStart: demoDate(-240),
    periodEnd: demoDate(60),
    zohoStatus: 'active',
    customerName: 'Health Systems Solutions',
    customerCode: 'HSS-001',
    proposalName: 'DOMO Analytics 2026',
    proposalNumber: 'PROP-0455',
    approver: 'Karen Doyle',
    customerManager: 'Robert King',
    leadDeveloper: 'Florencia Sarasúa',
    contractNumber: 'CT-2026-014',
    contractExpirationDate: demoDate(50),
    createdAt: '2026-01-10T10:00:00.000Z',
    updatedAt: '2026-01-10T10:00:00.000Z',
    createdBy: 'demo@southpoint.local',
  },
  {
    id: 'pr-2',
    client: 'Acme Analytics',
    projectName: 'Analytics Platform',
    projectNumber: 'PRJ-1002',
    sowNumber: 'SOW-2050',
    baseBudgetHours: 300,
    periodStart: demoDate(-190),
    periodEnd: demoDate(150),
    zohoStatus: 'active',
    customerName: 'Acme Corp',
    customerCode: 'ACME-002',
    proposalName: 'Analytics Platform Rollout',
    proposalNumber: 'PROP-0461',
    approver: 'James Wu',
    customerManager: 'Paula Méndez',
    leadDeveloper: 'Matías Sarasúa',
    contractNumber: 'CT-2026-021',
    contractExpirationDate: demoDate(20),
    createdAt: '2026-02-02T10:00:00.000Z',
    updatedAt: '2026-02-02T10:00:00.000Z',
    createdBy: 'demo@southpoint.local',
  },
  {
    id: 'pr-3',
    client: 'Southpoint (interno)',
    projectName: 'Internal Hours Allocation',
    projectNumber: 'PRJ-1003',
    sowNumber: null,
    baseBudgetHours: null,
    periodStart: null,
    periodEnd: null,
    zohoStatus: 'archived',
    customerName: 'Southpoint Tech Labs',
    customerCode: 'SP-000',
    proposalName: null,
    proposalNumber: null,
    approver: 'Eduardo R.',
    customerManager: 'Eduardo R.',
    leadDeveloper: 'Diego Pérez',
    contractNumber: 'CT-2025-099',
    contractExpirationDate: demoDate(140),
    createdAt: '2025-11-15T10:00:00.000Z',
    updatedAt: '2025-11-15T10:00:00.000Z',
    createdBy: 'demo@southpoint.local',
  },
  {
    id: 'pr-zoho',
    client: 'Northwind',
    projectName: 'Northwind Data Migration',
    projectNumber: 'Z-88421',
    sowNumber: null,
    baseBudgetHours: null,
    periodStart: null,
    periodEnd: null,
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
    sowNumber: 'SOW-1990',
    baseBudgetHours: 240,
    periodStart: demoDate(-320),
    periodEnd: demoDate(21),
    zohoStatus: 'active',
    customerName: 'Health Systems Solutions',
    customerCode: 'HSS-001',
    proposalName: 'ETL Maintenance',
    proposalNumber: 'PROP-0399',
    approver: 'Karen Doyle',
    customerManager: 'Robert King',
    leadDeveloper: 'Lucía Méndez',
    contractNumber: 'CT-2025-077',
    contractExpirationDate: demoDate(75),
    createdAt: '2025-09-01T10:00:00.000Z',
    updatedAt: '2025-09-01T10:00:00.000Z',
    createdBy: 'demo@southpoint.local',
  },
]

// Estado demo en memoria (para que crear/editar funcione sin Supabase).
let demoProjects = MOCK_PROJECTS.map((p) => ({ ...p }))
const demoHistory = {}
const demoStages = {} // projectId -> ProjectStage[]
const demoTasks = {} // projectId -> ProjectTask[]

function rowToProject(row) {
  return {
    id: row.id,
    client: row.client,
    clientId: row.client_id ?? null,
    baseBudgetHours: row.base_budget_hours != null ? Number(row.base_budget_hours) : null,
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
    // Id de Zoho del proyecto: la clave del join hora→proyecto. buildProjectIndex
    // arma byZohoId con esto; sin mapearlo, el join por id queda inerte y todo cae
    // al fallback por nombre. Ver entryClient.js / slice 3.
    zohoProjectId: row.zoho_project_id ?? null,
    // Grupo crudo de Zoho (allí el cliente vive como grupo). Lo consume
    // clientResolver para resolver proyecto→cliente por alias. Ver slice 3.
    zohoProjectGroup: row.zoho_project_group ?? null,
    sowNumber: row.sow_number ?? null,
    sowUrl: row.sow_url ?? null,
    // SOW de cada stage (uno por stage). Lo rellena getProjects con una query
    // batch; en el resto de los caminos (createProject/updateProject) queda [].
    // Alimenta el filtro y la columna SOW del listado. Ver ProjectsPage.
    stageSowNumbers: [],
    hasStages: row.has_stages ?? false,
    stageName: row.stage_name ?? null,
    model: row.model ?? null,
    periodStart: row.period_start ?? null,
    periodEnd: row.period_end ?? null,
    maintenanceEnabled: row.maintenance_enabled ?? false,
    slaTemplate: row.sla_template ?? null,
    maintenanceTransition: row.maintenance_transition ?? null,
    maintenanceHoursPool: row.maintenance_hours_pool != null ? Number(row.maintenance_hours_pool) : null,
    maintenanceDurationMonths: row.maintenance_duration_months != null ? Number(row.maintenance_duration_months) : null,
    maintenanceSlaTiers: row.maintenance_sla_tiers ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by ?? null,
  }
}

function projectToRow(project) {
  const row = {}
  for (const [field, column] of Object.entries(FIELD_TO_COLUMN)) {
    if (project[field] === undefined) continue
    // '' -> null para campos de texto; preserva 0 en campos numéricos (baseBudgetHours).
    // "client" es la excepción: `text not null` en la DB (0004_projects.sql,
    // nunca relajada) — mandarle null revienta el UPDATE/INSERT en vez de
    // guardar el resto del proyecto (proyecto linkeado con texto legacy vacío).
    row[column] = field === 'client' ? (project[field] ?? '') : project[field] === '' ? null : project[field] ?? null
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
    return [...demoProjects]
      .map((p) => ({
        ...p,
        stageSowNumbers: (demoStages[p.id] ?? [])
          .map((s) => s.sowNumber)
          .filter(Boolean),
      }))
      .sort((a, b) =>
        (a.contractExpirationDate || '9999-99-99').localeCompare(
          b.contractExpirationDate || '9999-99-99',
        ),
      )
  }
  // La lista de proyectos (crítica) y los SOW de stage que la enriquecen (no
  // críticos) son independientes → en paralelo, para no duplicar la latencia.
  // Solo se traen las filas con sow_number (las únicas que aportan al filtro y
  // la columna SOW del listado). Ver ProjectsPage.
  const [projectsRes, stagesRes] = await Promise.all([
    supabase
      .from('projects')
      .select('*')
      .order('contract_expiration_date', { ascending: true }),
    supabase
      .from('project_stages')
      .select('project_id, sow_number')
      .not('sow_number', 'is', null),
  ])
  if (projectsRes.error) throw new Error(projectsRes.error.message)
  const projects = projectsRes.data.map(rowToProject)

  // El enriquecimiento con SOW de stage NO tumba la página: si falla (RLS, red,
  // tabla no disponible) se loguea y los proyectos quedan con stageSowNumbers
  // vacío. La lista —el objetivo de la página— igual carga.
  if (stagesRes.error) {
    console.warn('No se pudieron cargar los SOW de stage:', stagesRes.error.message)
  } else {
    // PostgREST corta en 1000 filas por defecto. Hoy el volumen está muy por
    // debajo; si algún día se acerca, hay que paginar acá. Avisamos al tocar el
    // tope para que la truncación no sea silenciosa.
    if (stagesRes.data.length === 1000) {
      console.warn(
        'project_stages devolvió 1000 filas (posible tope de PostgREST); los SOW de stage podrían estar truncados — paginar getProjects.',
      )
    }
    const sowsByProject = new Map()
    for (const row of stagesRes.data) {
      const list = sowsByProject.get(row.project_id) ?? []
      list.push(row.sow_number)
      sowsByProject.set(row.project_id, list)
    }
    for (const project of projects) {
      project.stageSowNumbers = sowsByProject.get(project.id) ?? []
    }
  }
  return projects
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
    if (payload.projectNumber && demoProjects.some((p) => p.projectNumber === payload.projectNumber)) {
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

// ---------- Documentos (SOW / MSA / CR) — bucket 'project-documents' ----------

const SOW_BUCKET = 'project-documents'
const DOC_MAX_BYTES = 20 * 1024 * 1024 // 20 MB

/**
 * El navegador no siempre resuelve el MIME type de un .docx/.pdf (falta la
 * asociación en el SO → llega '' o 'application/octet-stream'). Se usa acá y
 * en ProjectWizardModal's onPickSowFile — un solo lugar para la definición de
 * "MIME genérico, hay que confiar en la extensión" en vez de dos.
 * @param {string} mimeType
 */
export function isGenericFileType(mimeType) {
  return !mimeType || mimeType === 'application/octet-stream'
}

/**
 * Sube el archivo del SOW a Storage. Acepta .docx (se parsea para
 * autocompletar Alcance) o PDF (SOW ya firmado).
 * @param {File} file
 * @returns {Promise<string>} path en el bucket
 */
export async function uploadSowFile(file) {
  if (!file) {
    const e = new Error('The SOW file is missing.')
    e.code = 'no_file'
    throw e
  }
  // El navegador no siempre resuelve el MIME type de un .docx/.pdf (falta la
  // asociación en el SO → llega '' o 'application/octet-stream'). El <input>
  // ya filtra por accept=".docx,.pdf" antes de esto, así que si el MIME type
  // vino vacío/genérico confiamos en la extensión del nombre de archivo.
  const name = file.name.toLowerCase()
  const okType =
    file.type === 'application/pdf' ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    (isGenericFileType(file.type) && (name.endsWith('.docx') || name.endsWith('.pdf')))
  if (!okType) {
    const e = new Error('The SOW must be a .docx or .pdf file.')
    e.code = 'bad_type'
    throw e
  }
  if (file.size > DOC_MAX_BYTES) {
    const e = new Error('The SOW file cannot exceed 20 MB.')
    e.code = 'too_big'
    throw e
  }

  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 300))
    return `demo/${Date.now()}-${file.name}`
  }

  const realType = name.endsWith('.pdf')
    ? 'application/pdf'
    : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  const contentType = isGenericFileType(file.type) ? realType : file.type
  // Sufijo random además de Date.now(): dos stages con el mismo nombre de
  // archivo (ej. ambos "SOW.docx") suben en paralelo (Promise.all) y pueden
  // caer en el mismo milisegundo, chocando con upsert:false.
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name}`
  const { error } = await supabase.storage
    .from(SOW_BUCKET)
    .upload(path, file, { contentType, upsert: false })
  if (error) throw new Error(error.message)
  return path
}

/**
 * Borra archivos huérfanos del bucket 'project-documents' — se sube el
 * archivo antes de intentar el insert/update que lo referencia (evita subir
 * dos veces si el resto falla), así que si ese paso posterior falla el
 * archivo ya subido queda sin ninguna fila que lo referencie. Best-effort:
 * no falla el flujo que la llama, solo loggea (mismo patrón que
 * recordProjectDocument).
 * @param {string[]} paths
 */
export async function removeSowFiles(paths) {
  if (!isSupabaseConfigured || !paths?.length) return
  const { error } = await supabase.storage.from(SOW_BUCKET).remove(paths)
  if (error) console.warn('[projects] no se pudieron limpiar los SOW subidos tras el fallo —', error.message)
}

/** URL firmada (60s) para descargar un documento del bucket 'project-documents'. */
export async function getProjectDocumentUrl(path) {
  if (!path) return null
  if (!isSupabaseConfigured) return null
  const { data, error } = await supabase.storage.from(SOW_BUCKET).createSignedUrl(path, 60)
  if (error) return null
  return data.signedUrl
}

/**
 * Registra una versión de documento (MSA/SOW/CR) en el historial y devuelve
 * la fila creada.
 *
 * La versión se estima contando las previas, pero entre el count y el insert
 * hay una ventana en la que otro puede tomar ese número — el índice único de
 * 0027 lo rechaza (23505) y se reintenta con el siguiente libre, igual que
 * createChangeRequest con cr_number. Si el count falla no se aborta: se
 * arranca en 1 y el reintento encuentra el hueco (perder el historial de un
 * documento que sí se subió es peor que una consulta de más).
 *
 * Tira si falla. Los flujos donde versionar es un efecto secundario del
 * alta/edición usan recordProjectDocument (wrapper best-effort de abajo);
 * los que le muestran el resultado al usuario necesitan enterarse del error.
 *
 * @param {{ subjectType: 'msa'|'sow'|'change_request', subjectId: string|number, fileUrl: string, uploadedBy?: ?string }} params
 * @returns {Promise<?Object>} la versión creada (null en modo demo).
 */
export async function recordProjectDocumentStrict({ subjectType, subjectId, fileUrl, uploadedBy }) {
  if (!isSupabaseConfigured) return null

  const { count, error: countError } = await supabase
    .from('project_documents')
    .select('id', { count: 'exact', head: true })
    .eq('subject_type', subjectType)
    .eq('subject_id', subjectId)
  if (countError) {
    console.warn('[projects] no se pudieron contar versiones previas —', countError.message)
  }
  const firstGuess = countError ? 1 : (count ?? 0) + 1

  const MAX_ATTEMPTS = 5
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const { data, error } = await supabase
      .from('project_documents')
      .insert({
        subject_type: subjectType,
        subject_id: subjectId,
        file_url: fileUrl,
        version: firstGuess + attempt,
        uploaded_by: uploadedBy || null,
      })
      .select()
      .single()
    if (!error) return rowToDocument(data)
    // 23505 = unique_violation: ese número ya lo tomó otra subida.
    if (error.code !== '23505') throw new Error(error.message)
  }
  throw new Error('Could not assign a document version — please try again.')
}

/**
 * Igual que recordProjectDocumentStrict pero best-effort: no falla el flujo
 * que la llama si algo sale mal, solo loggea (como logAudit). Para versionar
 * como efecto secundario de otra acción — el alta del wizard, un reemplazo
 * de SOW al editar — donde el trabajo principal ya se guardó y tumbar todo
 * por el historial sería peor que perderlo.
 * @param {{ subjectType: 'msa'|'sow'|'change_request', subjectId: string|number, fileUrl: string, uploadedBy?: ?string }} params
 */
export async function recordProjectDocument(params) {
  try {
    await recordProjectDocumentStrict(params)
  } catch (error) {
    console.warn('[projects] no se pudo registrar el documento —', error.message)
  }
}

function rowToDocument(row) {
  return {
    id: row.id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    fileUrl: row.file_url,
    version: row.version,
    uploadedAt: row.uploaded_at,
    uploadedBy: row.uploaded_by ?? null,
  }
}

/**
 * Todas las versiones de documento relevantes para un proyecto (issue 05):
 * el MSA de su cliente, el/los SOW del proyecto (uno por stage si
 * hasStages, uno solo si no), y los anexos de sus Change Requests. Cada
 * versión es su propia fila — recordProjectDocument solo inserta, nunca
 * pisa ni borra una anterior. Devuelve también `stages`/`changeRequests`
 * (id + nombre/número) — la UI los necesita para el selector de "a qué
 * subo esto", y ya los tenemos acá para armar `linkedToLabel`, así que
 * evita un segundo fetch redundante.
 * @param {{ id: string|number, client?: string, clientId: ?(string|number), hasStages: boolean }} project
 * @returns {Promise<{ documents: Array, stages: Array, changeRequests: Array }>}
 */
export async function getProjectDocuments(project) {
  // En demo igual se devuelven los stages (de demoStages, como
  // getProjectStages) — sin ellos el selector de "a qué subo esto" del slide
  // Documentos se queda sin ninguna opción de SOW para un proyecto con
  // stages. Los documentos sí van vacíos: no hay tabla que consultar.
  if (!isSupabaseConfigured) {
    // Los CRs salen de su propio módulo (igual que stages de getProjectStages)
    // para que el selector de "a qué subo esto" pueda ofrecer el anexo de un
    // CR recién creado también en demo.
    const { getChangeRequests } = await import('./changeRequestsData')
    return {
      documents: [],
      stages: project.hasStages ? await getProjectStages(project.id) : [],
      changeRequests: (await getChangeRequests(project.id)).map((cr) => ({ id: cr.id, crNumber: cr.crNumber })),
    }
  }

  const orParts = []
  const labelFor = {} // `${subjectType}:${subjectId}` -> texto para "Linked to"

  if (project.clientId) {
    orParts.push(`and(subject_type.eq.msa,subject_id.eq.${project.clientId})`)
    labelFor[`msa:${project.clientId}`] = `${project.client || 'Client'} · MSA`
  }

  // Las dos consultas son independientes entre sí (ambas solo dependen de
  // project.id) — en paralelo, no una atrás de la otra. Los stages salen de
  // getProjectStages (no de un select suelto acá) para que el selector los
  // liste siempre por `position`, igual que el resto de la app.
  const [stages, crResult] = await Promise.all([
    project.hasStages ? getProjectStages(project.id) : Promise.resolve([]),
    supabase.from('change_requests').select('id, cr_number').eq('project_id', project.id),
  ])
  if (crResult.error) throw new Error(crResult.error.message)

  if (project.hasStages) {
    stages.forEach((s) => {
      labelFor[`sow:${s.id}`] = `${s.stageName} · SOW`
    })
    if (stages.length) orParts.push(`and(subject_type.eq.sow,subject_id.in.(${stages.map((s) => s.id).join(',')}))`)
  } else {
    orParts.push(`and(subject_type.eq.sow,subject_id.eq.${project.id})`)
    labelFor[`sow:${project.id}`] = 'This project · SOW'
  }

  const changeRequests = (crResult.data ?? []).map((r) => ({ id: r.id, crNumber: r.cr_number }))
  changeRequests.forEach((cr) => {
    labelFor[`change_request:${cr.id}`] = `${cr.crNumber} · annex`
  })
  if (changeRequests.length) {
    orParts.push(`and(subject_type.eq.change_request,subject_id.in.(${changeRequests.map((c) => c.id).join(',')}))`)
  }

  if (!orParts.length) return { documents: [], stages, changeRequests }

  const { data, error } = await supabase
    .from('project_documents')
    .select('*')
    .or(orParts.join(','))
    .order('version', { ascending: false })
  if (error) throw new Error(error.message)
  const documents = data.map((row) => ({
    ...rowToDocument(row),
    linkedToLabel: labelFor[`${row.subject_type}:${row.subject_id}`] ?? row.subject_type,
  }))
  return { documents, stages, changeRequests }
}

// ---------- Stages y Tasks del SOW (Fase 4d) — helpers CRUD compartidos,
// mappers de fila y funciones específicas de cada uno más abajo ----------

function rowToStage(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    position: row.position,
    stageName: row.stage_name,
    sowNumber: row.sow_number,
    sowUrl: row.sow_url ?? null,
    createdAt: row.created_at,
    createdBy: row.created_by ?? null,
  }
}

function rowToTask(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    taskName: row.task_name,
    role: row.role ?? null,
    estimatedHours: Number(row.estimated_hours),
    createdAt: row.created_at,
    createdBy: row.created_by ?? null,
  }
}

/**
 * Trae los hijos de un proyecto (stages o tasks) — misma forma de consulta
 * para ambos, solo cambia la tabla, la columna de orden y el mapper de fila.
 */
async function getProjectChildren(table, projectId, orderColumn, rowToEntity, demoStore) {
  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 150))
    return demoStore[projectId] ?? []
  }
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('project_id', projectId)
    .order(orderColumn, { ascending: true })
  if (error) throw new Error(error.message)
  return data.map(rowToEntity)
}

/**
 * Alta en bloque de los hijos de un proyecto recién creado (stages o
 * tasks) — misma forma de inserción para ambos, solo cambia cómo se arma
 * la fila/entidad demo de cada item.
 */
async function createProjectChildren({ table, projectId, items, demoStore, toDemoEntity, toRow, rowToEntity }) {
  if (!items?.length) return []

  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 200))
    const created = items.map(toDemoEntity)
    demoStore[projectId] = [...(demoStore[projectId] ?? []), ...created]
    return created
  }

  // Uno por vez, no `insert(rows).select()`: un insert multi-fila no
  // garantiza que el orden de vuelta coincida con el de entrada, y el
  // caller (ej. ProjectsPage) empareja el resultado con datos externos
  // (la URL del SOW subido) por índice de array.
  const created = []
  for (const [i, item] of items.entries()) {
    const { data, error } = await supabase.from(table).insert(toRow(item, i)).select().single()
    if (error) throw new Error(error.message)
    created.push(rowToEntity(data))
  }
  return created
}

// ---------- Stages (Fase 4d) — un proyecto con has_stages=true tiene N stages,
// cada uno con su propio SOW ----------

/** @returns {Promise<Array>} stages de un proyecto, ordenados por posición. */
export async function getProjectStages(projectId) {
  return getProjectChildren('project_stages', projectId, 'position', rowToStage, demoStages)
}

/**
 * Crea los stages de un proyecto recién creado (alta en bloque, en el orden
 * en que se agregaron en el wizard).
 * @param {string|number} projectId
 * @param {Array<{ stageName: string, sowNumber: string, sowUrl: ?string }>} stages
 * @param {?string} createdBy
 * @param {number} startPosition  0 al crear el proyecto; longitud de los
 *   stages ya existentes cuando se agregan más en edición (issue 03b) — si
 *   no, la posición de los nuevos chocaría con la de los que ya están.
 * @returns {Promise<Array>}
 */
export async function createProjectStages(projectId, stages, createdBy, startPosition = 0) {
  return createProjectChildren({
    table: 'project_stages',
    projectId,
    items: stages,
    demoStore: demoStages,
    toDemoEntity: (s, i) => ({
      id: `stg-demo-${Date.now()}-${i}`,
      projectId,
      position: startPosition + i,
      stageName: s.stageName,
      sowNumber: s.sowNumber,
      sowUrl: s.sowUrl ?? null,
      createdAt: new Date().toISOString(),
      createdBy: createdBy || null,
    }),
    toRow: (s, i) => ({
      project_id: projectId,
      position: startPosition + i,
      stage_name: s.stageName,
      sow_number: s.sowNumber,
      sow_url: s.sowUrl ?? null,
      created_by: createdBy || null,
    }),
    rowToEntity: rowToStage,
  })
}

/**
 * Actualiza un stage existente (nombre, SOW number, y su SOW URL si se
 * reemplazó el archivo). Sin delete — 0025_project_stages_update_policy.sql
 * solo agregó update, mismo patrón "nadie borra" del resto de la app.
 * @param {{ id: string|number, projectId: string|number }} current
 * @param {{ stageName?: string, sowNumber?: string, sowUrl?: ?string }} updates
 * @returns {Promise<Object>}
 */
export async function updateProjectStage(current, updates) {
  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 150))
    const updated = { ...current, ...updates }
    demoStages[current.projectId] = (demoStages[current.projectId] ?? []).map((s) =>
      s.id === current.id ? updated : s,
    )
    return updated
  }
  const row = {}
  if (updates.stageName !== undefined) row.stage_name = updates.stageName
  if (updates.sowNumber !== undefined) row.sow_number = updates.sowNumber
  if (updates.sowUrl !== undefined) row.sow_url = updates.sowUrl
  const { data, error } = await supabase.from('project_stages').update(row).eq('id', current.id).select().single()
  if (error) throw new Error(error.message)
  return rowToStage(data)
}

// ---------- Tasks del SOW (Fase 4d) ----------

/** @returns {Promise<Array>} tasks del SOW de un proyecto. */
export async function getProjectTasks(projectId) {
  return getProjectChildren('project_tasks', projectId, 'id', rowToTask, demoTasks)
}

/**
 * Crea las tasks del SOW de un proyecto recién creado (alta en bloque).
 * @param {string|number} projectId
 * @param {Array<{ taskName: string, role: ?string, estimatedHours: number }>} tasks
 * @param {?string} createdBy
 * @returns {Promise<Array>}
 */
export async function createProjectTasks(projectId, tasks, createdBy) {
  return createProjectChildren({
    table: 'project_tasks',
    projectId,
    items: tasks,
    demoStore: demoTasks,
    toDemoEntity: (t, i) => ({
      id: `tsk-demo-${Date.now()}-${i}`,
      projectId,
      taskName: t.taskName,
      role: t.role ?? null,
      estimatedHours: Number(t.estimatedHours),
      createdAt: new Date().toISOString(),
      createdBy: createdBy || null,
    }),
    toRow: (t) => ({
      project_id: projectId,
      task_name: t.taskName,
      role: t.role || null,
      estimated_hours: Number(t.estimatedHours),
      created_by: createdBy || null,
    }),
    rowToEntity: rowToTask,
  })
}

/**
 * Actualiza una task existente (nombre, rol, horas estimadas). Sin delete —
 * 0023_project_tasks_update_policy.sql solo agregó update, mismo patrón
 * "nadie borra" del resto de la app.
 * @param {{ id: string|number, projectId: string|number }} current
 * @param {{ taskName?: string, role?: ?string, estimatedHours?: number }} updates
 * @returns {Promise<Object>}
 */
export async function updateProjectTask(current, updates) {
  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 150))
    const updated = { ...current, ...updates }
    demoTasks[current.projectId] = (demoTasks[current.projectId] ?? []).map((t) =>
      t.id === current.id ? updated : t,
    )
    return updated
  }
  const row = {}
  if (updates.taskName !== undefined) row.task_name = updates.taskName
  if (updates.role !== undefined) row.role = updates.role || null
  if (updates.estimatedHours !== undefined) row.estimated_hours = Number(updates.estimatedHours)
  const { data, error } = await supabase.from('project_tasks').update(row).eq('id', current.id).select().single()
  if (error) throw new Error(error.message)
  return rowToTask(data)
}

/**
 * Alta completa de un proyecto desde el wizard: sube el/los SOW (uno por
 * stage si hasStages, uno solo si no) antes de crear nada — es la parte más
 * propensa a fallar (tamaño, tipo, red) — y recién con eso resuelto crea el
 * proyecto, sus stages/tasks y versiona cada documento.
 *
 * projects no tiene política de borrado (se conserva el historial a
 * propósito, ver 0004_projects.sql), así que si algo falla *después* de
 * crear la fila del proyecto no hay rollback posible: se devuelve igual
 * el proyecto ya creado junto con el error, para que el caller decida cómo
 * avisarle al usuario en vez de dejar un huérfano invisible.
 *
 * @param {object} payload  el objeto que arma ProjectWizardModal (incluye
 *   sowFile, stages[], tasks[] además de los campos de projects)
 * @param {?string} createdBy
 * @returns {Promise<{ project: Project, partialFailure: ?Error }>}
 */
export async function createProjectFromWizard(payload, createdBy) {
  const { stages, tasks, sowFile, ...projectFields } = payload

  const sowUrl = payload.hasStages ? null : await uploadSowFile(sowFile)

  // allSettled, no all: si el stage 3 de 3 falla, los stages 1 y 2 ya
  // terminaron de subirse a Storage — necesitamos sus paths para poder
  // limpiarlos, cosa que Promise.all no nos da (rechaza sin resultados).
  const stageUploads = payload.hasStages
    ? await Promise.allSettled(
        (stages ?? []).map((stage) =>
          uploadSowFile(stage.sowFile).then((url) => ({
            stageName: stage.stageName,
            sowNumber: stage.sowNumber,
            sowUrl: url,
          })),
        ),
      )
    : []
  const firstStageFailure = stageUploads.find((r) => r.status === 'rejected')
  const stageUploadPaths = stageUploads
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value.sowUrl)
  if (firstStageFailure) {
    await removeSowFiles(stageUploadPaths)
    throw firstStageFailure.reason
  }
  const stagesWithUrls = stageUploads.map((r) => r.value)

  const uploadedPaths = [sowUrl, ...stageUploadPaths].filter(Boolean)
  let project
  try {
    project = await createProject({ ...projectFields, sowUrl }, createdBy)
  } catch (error) {
    // El proyecto no se llegó a crear — a diferencia de projects (que no se
    // borra, se conserva historial), un archivo de Storage sin ninguna fila
    // que lo referencie es pura basura: lo limpiamos para no dejarlo huérfano.
    await removeSowFiles(uploadedPaths)
    throw error
  }

  try {
    if (!payload.hasStages && sowUrl) {
      await recordProjectDocument({
        subjectType: 'sow',
        subjectId: project.id,
        fileUrl: sowUrl,
        uploadedBy: createdBy,
      })
    }

    if (payload.hasStages && stagesWithUrls.length) {
      const createdStages = await createProjectStages(project.id, stagesWithUrls, createdBy)
      await Promise.all(
        createdStages.map((stage, i) =>
          recordProjectDocument({
            subjectType: 'sow',
            subjectId: stage.id,
            fileUrl: stagesWithUrls[i].sowUrl,
            uploadedBy: createdBy,
          }),
        ),
      )
    }

    if (tasks?.length) {
      await createProjectTasks(project.id, tasks, createdBy)
    }
    return { project, partialFailure: null }
  } catch (error) {
    return { project, partialFailure: error }
  }
}
