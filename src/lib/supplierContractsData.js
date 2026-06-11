/**
 * Capa de datos del módulo Supplier Contracts (FR-14).
 *
 * @typedef {Object} SupplierContract
 * @property {string|number} id
 * @property {string} supplierName
 * @property {boolean} isPrioritySupplier
 * @property {string} contractNumber
 * @property {string} startDate
 * @property {string} expirationDate
 * @property {string} renewalDate
 * @property {'Net 15'|'Net 30'|'Net 45'} paymentTerms
 * @property {'Manual'|'Auto-notify'} renewalType
 * @property {string} status
 * @property {?string} pdfUrl
 * @property {boolean} archived
 * @property {?(string|number)} parentContractId
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {?string} createdBy
 */

import { supabase, isSupabaseConfigured } from './supabase'
import { daysRemaining } from './projectsData'

export const PAYMENT_TERMS = ['Net 15', 'Net 30', 'Net 45']
export const RENEWAL_TYPES = ['Manual', 'Auto-notify']
export const SUPPLIER_STATUSES = [
  'Active',
  'Renewal in Progress',
  'Expiring Soon',
  'Critical',
  'Expired',
]

const FIELD_TO_COLUMN = {
  supplierName: 'supplier_name',
  isPrioritySupplier: 'is_priority_supplier',
  contractNumber: 'contract_number',
  startDate: 'start_date',
  expirationDate: 'expiration_date',
  renewalDate: 'renewal_date',
  paymentTerms: 'payment_terms',
  renewalType: 'renewal_type',
}

/** Estado calculado por días restantes (la columna 'Renewal in Progress' es manual). */
export function supplierContractStatus(days) {
  if (days == null) return 'Active'
  if (days < 0) return 'Expired'
  if (days <= 30) return 'Critical'
  if (days <= 60) return 'Expiring Soon'
  return 'Active'
}

/**
 * Estado a mostrar: 'Renewal in Progress' se respeta MIENTRAS el snooze siga
 * vigente; al vencer el snooze, vuelve al estado calculado por fecha.
 */
export function displaySupplierStatus(contract) {
  if (contract.status === 'Renewal in Progress') {
    const active = !contract.snoozeUntil || new Date(contract.snoozeUntil) > new Date()
    if (active) return 'Renewal in Progress'
  }
  return supplierContractStatus(daysRemaining(contract.expirationDate))
}

/** Tinte de fila por proximidad (5 bandas): red/orange/yellow/light/''. */
export function supplierRowTint(days) {
  if (days == null) return ''
  if (days < 0) return 'red'
  if (days <= 30) return 'orange'
  if (days <= 60) return 'yellow'
  if (days <= 90) return 'light'
  return ''
}

/**
 * Contratos priority "en alerta" para el banner persistente (FR-16): activos,
 * de proveedor priority, dentro del umbral más amplio y NO snoozed. Más urgente
 * primero (menos días restantes).
 *
 * @param {SupplierContract[]} contracts
 * @param {number} widestThreshold  umbral más amplio en días (ej. 90)
 * @returns {SupplierContract[]}
 */
export function priorityAlertContracts(contracts, widestThreshold = 90) {
  return contracts
    .filter((c) => c.isPrioritySupplier && !c.archived)
    .filter((c) => displaySupplierStatus(c) !== 'Renewal in Progress')
    .filter((c) => {
      const days = daysRemaining(c.expirationDate)
      return days != null && days <= widestThreshold
    })
    .sort((a, b) => daysRemaining(a.expirationDate) - daysRemaining(b.expirationDate))
}

/** @type {SupplierContract[]} */
const MOCK_CONTRACTS = [
  {
    id: 'sc-1',
    supplierName: 'southpointlabs',
    isPrioritySupplier: true,
    contractNumber: 'SC-2026-001',
    startDate: '2025-07-15',
    expirationDate: '2026-07-05',
    renewalDate: '2026-06-15',
    paymentTerms: 'Net 30',
    renewalType: 'Auto-notify',
    status: 'Active',
    pdfUrl: null,
    archived: false,
    parentContractId: 'sc-0',
    createdAt: '2025-07-15T10:00:00.000Z',
    updatedAt: '2025-07-15T10:00:00.000Z',
    createdBy: 'demo@southpoint.local',
  },
  {
    id: 'sc-0',
    supplierName: 'southpointlabs',
    isPrioritySupplier: true,
    contractNumber: 'SC-2024-001',
    startDate: '2024-07-15',
    expirationDate: '2025-07-14',
    renewalDate: '2025-06-15',
    paymentTerms: 'Net 30',
    renewalType: 'Auto-notify',
    status: 'Expired',
    pdfUrl: null,
    archived: true,
    parentContractId: null,
    createdAt: '2024-07-15T10:00:00.000Z',
    updatedAt: '2025-07-15T10:00:00.000Z',
    createdBy: 'demo@southpoint.local',
  },
  {
    id: 'sc-2',
    supplierName: 'Acme Cloud Services',
    isPrioritySupplier: false,
    contractNumber: 'SC-2025-014',
    startDate: '2025-06-20',
    expirationDate: '2026-06-25',
    renewalDate: '2026-05-25',
    paymentTerms: 'Net 15',
    renewalType: 'Manual',
    status: 'Active',
    pdfUrl: null,
    archived: false,
    parentContractId: null,
    createdAt: '2025-06-20T10:00:00.000Z',
    updatedAt: '2025-06-20T10:00:00.000Z',
    createdBy: 'demo@southpoint.local',
  },
  {
    id: 'sc-3',
    supplierName: 'DataCorp',
    isPrioritySupplier: false,
    contractNumber: 'SC-2025-031',
    startDate: '2025-12-01',
    expirationDate: '2026-12-31',
    renewalDate: '2026-11-30',
    paymentTerms: 'Net 45',
    renewalType: 'Auto-notify',
    status: 'Active',
    pdfUrl: null,
    archived: false,
    parentContractId: null,
    createdAt: '2025-12-01T10:00:00.000Z',
    updatedAt: '2025-12-01T10:00:00.000Z',
    createdBy: 'demo@southpoint.local',
  },
]

let demoContracts = MOCK_CONTRACTS.map((c) => ({ ...c }))
const demoHistory = {}

// --- Estado demo de alertas (FR-16) ---
let demoAlertSettings = {
  threshold1Days: 90,
  threshold2Days: 60,
  threshold3Days: 30,
  emailRecipients: ['ops@southpoint.local'],
  prioritySupplierEmailRecipients: ['ops@southpoint.local', 'management@southpoint.local'],
  updatedAt: null,
  updatedBy: null,
}
/** @type {Object<string, Array>} alert-log demo, por contract id */
const demoAlertLog = {
  'sc-1': [
    {
      id: 'sa-seed-1',
      thresholdCrossed: 90,
      emailSentAt: '2026-04-06T08:00:00.000Z',
      dismissedAt: null,
      dismissedBy: null,
      actionTaken: null,
      createdAt: '2026-04-06T08:00:00.000Z',
    },
  ],
}

function rowToContract(row) {
  return {
    id: row.id,
    supplierName: row.supplier_name,
    isPrioritySupplier: Boolean(row.is_priority_supplier),
    contractNumber: row.contract_number,
    startDate: row.start_date,
    expirationDate: row.expiration_date,
    renewalDate: row.renewal_date,
    paymentTerms: row.payment_terms,
    renewalType: row.renewal_type,
    status: row.status,
    pdfUrl: row.pdf_url ?? null,
    archived: Boolean(row.archived),
    parentContractId: row.parent_contract_id ?? null,
    snoozeUntil: row.snooze_until ?? null,
    previousStatus: row.previous_status ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by ?? null,
  }
}

function contractToRow(c) {
  const row = {}
  for (const [field, column] of Object.entries(FIELD_TO_COLUMN)) {
    if (c[field] !== undefined) row[column] = c[field]
  }
  return row
}

const sortByExp = (list) =>
  [...list].sort((a, b) => a.expirationDate.localeCompare(b.expirationDate))

/** @returns {Promise<SupplierContract[]>} no archivados, por vencimiento asc. */
export async function getSupplierContracts({ includeArchived = false } = {}) {
  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 250))
    const list = includeArchived ? demoContracts : demoContracts.filter((c) => !c.archived)
    return sortByExp(list)
  }
  let query = supabase.from('supplier_contracts').select('*').order('expiration_date', { ascending: true })
  if (!includeArchived) query = query.eq('archived', false)
  const { data, error } = await query
  if (error) {
    console.warn('[supplier] getSupplierContracts falló —', error.message)
    return sortByExp(demoContracts.filter((c) => !c.archived))
  }
  return data.map(rowToContract)
}

export async function createSupplierContract(payload, createdBy) {
  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 300))
    if (demoContracts.some((c) => c.contractNumber === payload.contractNumber)) {
      const err = new Error('Contract # already exists.')
      err.code = 'duplicate'
      throw err
    }
    const contract = {
      id: `sc-demo-${Date.now()}`,
      pdfUrl: null,
      archived: false,
      parentContractId: null,
      status: 'Active',
      ...payload,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: createdBy || null,
    }
    demoContracts = [contract, ...demoContracts]
    return contract
  }
  const row = { ...contractToRow(payload), created_by: createdBy || null }
  if (payload.pdfUrl !== undefined) row.pdf_url = payload.pdfUrl
  const { data, error } = await supabase
    .from('supplier_contracts')
    .insert(row)
    .select()
    .single()
  if (error) {
    if (error.code === '23505') {
      const err = new Error('Contract # already exists.')
      err.code = 'duplicate'
      throw err
    }
    throw new Error(error.message)
  }
  return rowToContract(data)
}

export async function updateSupplierContract(current, updates, changedBy) {
  const changes = []
  for (const field of Object.keys(FIELD_TO_COLUMN)) {
    if (updates[field] === undefined) continue
    if (String(current[field] ?? '') !== String(updates[field] ?? '')) {
      changes.push({ field, before: current[field] ?? null, after: updates[field] ?? null })
    }
  }

  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 300))
    if (
      updates.contractNumber &&
      updates.contractNumber !== current.contractNumber &&
      demoContracts.some((c) => c.contractNumber === updates.contractNumber)
    ) {
      const err = new Error('Contract # already exists.')
      err.code = 'duplicate'
      throw err
    }
    const updated = { ...current, ...updates, updatedAt: new Date().toISOString() }
    demoContracts = demoContracts.map((c) => (c.id === current.id ? updated : c))
    demoHistory[current.id] = [
      ...changes.map((c, i) => ({
        id: `sh-${Date.now()}-${i}`,
        fieldName: c.field,
        oldValue: c.before,
        newValue: c.after,
        changedAt: new Date().toISOString(),
        changedBy: changedBy || null,
      })),
      ...(demoHistory[current.id] ?? []),
    ]
    return updated
  }

  const updateRow = contractToRow(updates)
  if (updates.pdfUrl !== undefined) updateRow.pdf_url = updates.pdfUrl
  const { data, error } = await supabase
    .from('supplier_contracts')
    .update(updateRow)
    .eq('id', current.id)
    .select()
    .single()
  if (error) {
    if (error.code === '23505') {
      const err = new Error('Contract # already exists.')
      err.code = 'duplicate'
      throw err
    }
    throw new Error(error.message)
  }
  if (changes.length) {
    await supabase.from('supplier_contract_history').insert(
      changes.map((c) => ({
        contract_id: current.id,
        field_name: c.field,
        old_value: c.before == null ? null : String(c.before),
        new_value: c.after == null ? null : String(c.after),
        changed_by: changedBy || null,
      })),
    )
  }
  return rowToContract(data)
}

export async function getSupplierContractHistory(contractId) {
  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 150))
    return demoHistory[contractId] ?? []
  }
  const { data, error } = await supabase
    .from('supplier_contract_history')
    .select('id, field_name, old_value, new_value, changed_at, changed_by')
    .eq('contract_id', contractId)
    .order('changed_at', { ascending: false })
  if (error) return []
  return data.map((row) => ({
    id: row.id,
    fieldName: row.field_name,
    oldValue: row.old_value,
    newValue: row.new_value,
    changedAt: row.changed_at,
    changedBy: row.changed_by,
  }))
}

const PDF_MAX_BYTES = 20 * 1024 * 1024 // 20 MB
const BUCKET = 'supplier-contracts'

/**
 * Sube un PDF al bucket de Storage y devuelve el path guardado.
 * Valida MIME (application/pdf) y tamaño (<= 20 MB).
 * @param {File} file
 * @returns {Promise<string>} path en el bucket
 */
export async function uploadContractPdf(file) {
  if (!file) {
    const e = new Error('PDF is missing.')
    e.code = 'no_file'
    throw e
  }
  if (file.type !== 'application/pdf') {
    const e = new Error('The file must be a PDF.')
    e.code = 'bad_type'
    throw e
  }
  if (file.size > PDF_MAX_BYTES) {
    const e = new Error('The PDF cannot exceed 20 MB.')
    e.code = 'too_big'
    throw e
  }

  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 300))
    return `demo://${file.name}`
  }

  const safe = file.name.replace(/[^\w.-]/g, '_')
  const path = `contracts/${Date.now()}-${safe}`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: 'application/pdf', upsert: false })
  if (error) throw new Error(error.message)
  return path
}

/** URL firmada (60s) para descargar el PDF de un contrato. */
export async function getContractPdfUrl(pdfUrl) {
  if (!pdfUrl) return null
  if (!isSupabaseConfigured) return null
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(pdfUrl, 60)
  if (error) return null
  return data.signedUrl
}

/**
 * Renueva un contrato: archiva el viejo (archived=true) e inserta uno nuevo
 * con parent_contract_id = id del viejo, status 'Active'.
 *
 * @param {SupplierContract} oldContract
 * @param {{ contractNumber, startDate, expirationDate, renewalDate, pdfUrl }} payload
 * @param {?string} by
 * @returns {Promise<{ archived: SupplierContract, created: SupplierContract }>}
 */
export async function renewSupplierContract(oldContract, payload, by) {
  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 350))
    const created = {
      id: `sc-demo-${Date.now()}`,
      supplierName: oldContract.supplierName,
      isPrioritySupplier: oldContract.isPrioritySupplier,
      contractNumber: payload.contractNumber,
      startDate: payload.startDate,
      expirationDate: payload.expirationDate,
      renewalDate: payload.renewalDate,
      paymentTerms: oldContract.paymentTerms,
      renewalType: oldContract.renewalType,
      status: 'Active',
      pdfUrl: payload.pdfUrl ?? null,
      archived: false,
      parentContractId: oldContract.id,
      snoozeUntil: null,
      previousStatus: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: by || null,
    }
    const archived = { ...oldContract, archived: true }
    demoContracts = [created, ...demoContracts.map((c) => (c.id === oldContract.id ? archived : c))]
    pushDemoAlertAction(oldContract.id, 'renew', by)
    return { archived, created }
  }

  await supabase.from('supplier_contracts').update({ archived: true }).eq('id', oldContract.id)
  await recordAlertAction(oldContract.id, 'renew', by)
  const { data, error } = await supabase
    .from('supplier_contracts')
    .insert({
      supplier_name: oldContract.supplierName,
      is_priority_supplier: oldContract.isPrioritySupplier,
      contract_number: payload.contractNumber,
      start_date: payload.startDate,
      expiration_date: payload.expirationDate,
      renewal_date: payload.renewalDate,
      payment_terms: oldContract.paymentTerms,
      renewal_type: oldContract.renewalType,
      status: 'Active',
      pdf_url: payload.pdfUrl ?? null,
      parent_contract_id: oldContract.id,
      created_by: by || null,
    })
    .select()
    .single()
  if (error) {
    if (error.code === '23505') {
      const err = new Error('Contract # already exists.')
      err.code = 'duplicate'
      throw err
    }
    throw new Error(error.message)
  }
  return { archived: { ...oldContract, archived: true }, created: rowToContract(data) }
}

/**
 * Marca un contrato como 'Renewal in Progress' y lo silencia por `snoozeDays`.
 * Guarda el estado calculado previo para revertir cuando venza el snooze.
 */
export async function markRenewalInProgress(contract, snoozeDays, by) {
  const prev = displaySupplierStatus(contract)
  const until = new Date(Date.now() + (snoozeDays ?? 7) * 86400000).toISOString()

  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 250))
    const updated = {
      ...contract,
      status: 'Renewal in Progress',
      snoozeUntil: until,
      previousStatus: prev,
    }
    demoContracts = demoContracts.map((c) => (c.id === contract.id ? updated : c))
    demoHistory[contract.id] = [
      {
        id: `sh-${Date.now()}`,
        fieldName: 'status',
        oldValue: prev,
        newValue: 'Renewal in Progress',
        changedAt: new Date().toISOString(),
        changedBy: by || null,
      },
      ...(demoHistory[contract.id] ?? []),
    ]
    pushDemoAlertAction(contract.id, 'renew_in_progress', by)
    return updated
  }

  const { data, error } = await supabase
    .from('supplier_contracts')
    .update({ status: 'Renewal in Progress', snooze_until: until, previous_status: prev })
    .eq('id', contract.id)
    .select()
    .single()
  if (error) throw new Error(error.message)
  await supabase.from('supplier_contract_history').insert({
    contract_id: contract.id,
    field_name: 'status',
    old_value: prev,
    new_value: 'Renewal in Progress',
    changed_by: by || null,
  })
  await recordAlertAction(contract.id, 'renew_in_progress', by)
  return rowToContract(data)
}

// ---------- Alertas (FR-16) ----------

function pushDemoAlertAction(contractId, action, by) {
  const id = String(contractId)
  demoAlertLog[id] = [
    {
      id: `sa-${Date.now()}`,
      thresholdCrossed: null,
      emailSentAt: null,
      dismissedAt: new Date().toISOString(),
      dismissedBy: by || null,
      actionTaken: action,
      createdAt: new Date().toISOString(),
    },
    ...(demoAlertLog[id] ?? []),
  ]
}

/** Registra una acción ('renew' | 'renew_in_progress' | 'manual_dismiss') en el log. */
export async function recordAlertAction(contractId, action, by) {
  if (!isSupabaseConfigured) {
    pushDemoAlertAction(contractId, action, by)
    return
  }
  await supabase.from('supplier_alert_log').insert({
    contract_id: contractId,
    action_taken: action,
    dismissed_at: new Date().toISOString(),
    dismissed_by: by || null,
  })
}

function rowToAlertSettings(row) {
  return {
    threshold1Days: row.threshold_1_days,
    threshold2Days: row.threshold_2_days,
    threshold3Days: row.threshold_3_days,
    emailRecipients: row.email_recipients ?? [],
    prioritySupplierEmailRecipients: row.priority_supplier_email_recipients ?? [],
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }
}

/** @returns {Promise<object>} configuración de alertas de supplier contracts. */
export async function getSupplierAlertSettings() {
  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 150))
    return { ...demoAlertSettings }
  }
  const { data, error } = await supabase
    .from('supplier_alert_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle()
  if (error || !data) {
    console.warn('[supplier] getSupplierAlertSettings —', error?.message)
    return { ...demoAlertSettings }
  }
  return rowToAlertSettings(data)
}

/** Guarda la configuración (upsert de la fila singleton id=1). */
export async function updateSupplierAlertSettings(settings, updatedBy) {
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
    .from('supplier_alert_settings')
    .update({
      threshold_1_days: settings.threshold1Days,
      threshold_2_days: settings.threshold2Days,
      threshold_3_days: settings.threshold3Days,
      email_recipients: settings.emailRecipients,
      priority_supplier_email_recipients: settings.prioritySupplierEmailRecipients,
      updated_by: updatedBy || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return rowToAlertSettings(data)
}

/** Historial de alertas (emails + acciones) de un contrato, más reciente primero. */
export async function getSupplierAlertHistory(contractId) {
  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 150))
    return demoAlertLog[String(contractId)] ?? []
  }
  const { data, error } = await supabase
    .from('supplier_alert_log')
    .select('id, threshold_crossed, email_sent_at, dismissed_at, dismissed_by, action_taken, created_at')
    .eq('contract_id', contractId)
    .order('created_at', { ascending: false })
  if (error) return []
  return data.map((row) => ({
    id: row.id,
    thresholdCrossed: row.threshold_crossed,
    emailSentAt: row.email_sent_at,
    dismissedAt: row.dismissed_at,
    dismissedBy: row.dismissed_by,
    actionTaken: row.action_taken,
    createdAt: row.created_at,
  }))
}

/** Versiones anteriores (cadena de parent_contract_id), más reciente primero. */
export async function getRenewalHistory(contract) {
  if (!contract?.parentContractId) return []
  const all = await getSupplierContracts({ includeArchived: true })
  const byId = new Map(all.map((c) => [String(c.id), c]))
  const chain = []
  let parentId = contract.parentContractId
  const guard = new Set()
  while (parentId != null && !guard.has(String(parentId))) {
    guard.add(String(parentId))
    const parent = byId.get(String(parentId))
    if (!parent) break
    chain.push(parent)
    parentId = parent.parentContractId
  }
  return chain
}
