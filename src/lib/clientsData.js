/**
 * Capa de datos del módulo Clients (alta de clientes).
 * Lee/escribe en Supabase si está configurado; si no, modo demo con mock.
 *
 * @typedef {Object} Client
 * @property {string|number} id
 * @property {string} clientName
 * @property {?string} email
 * @property {?string} domain
 * @property {string} primaryContactName
 * @property {string} primaryContactEmail
 * @property {string} msaUrl        path en el bucket 'client-msa'
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {?string} createdBy
 */

import { supabase, isSupabaseConfigured } from './supabase'
import { recordProjectDocument } from './projectsData'

const BUCKET = 'client-msa'
const MSA_MAX_BYTES = 20 * 1024 * 1024 // 20 MB

const FIELD_TO_COLUMN = {
  clientName: 'client_name',
  email: 'email',
  domain: 'domain',
  primaryContactName: 'primary_contact_name',
  primaryContactEmail: 'primary_contact_email',
  msaUrl: 'msa_url',
}

/** @type {Client[]} */
const MOCK_CLIENTS = [
  {
    id: 'cl-1',
    clientName: 'Acme Corp',
    email: 'ops@acme.com',
    domain: 'acme.com',
    primaryContactName: 'Sarah Connor',
    primaryContactEmail: 'sarah.connor@acme.com',
    msaUrl: 'demo/acme-msa.pdf',
    createdAt: '2026-01-15T10:00:00.000Z',
    updatedAt: '2026-01-15T10:00:00.000Z',
    createdBy: 'demo@southpoint.local',
  },
  {
    id: 'cl-2',
    clientName: 'Health Systems Solutions',
    email: null,
    domain: 'hss.com',
    primaryContactName: 'Robert King',
    primaryContactEmail: 'robert.king@hss.com',
    msaUrl: 'demo/hss-msa.pdf',
    createdAt: '2026-02-01T10:00:00.000Z',
    updatedAt: '2026-02-01T10:00:00.000Z',
    createdBy: 'demo@southpoint.local',
  },
]

// Estado demo en memoria (para que crear funcione sin Supabase).
let demoClients = MOCK_CLIENTS.map((c) => ({ ...c }))

function rowToClient(row) {
  return {
    id: row.id,
    clientName: row.client_name,
    // Alias del grupo de Zoho → este cliente (ej. grupo "HSS" → "HSSStaffing").
    // Lo consume clientResolver (slice 3). El write path (UI) llega con el cableado.
    zohoGroupName: row.zoho_group_name ?? null,
    email: row.email ?? null,
    domain: row.domain ?? null,
    primaryContactName: row.primary_contact_name,
    primaryContactEmail: row.primary_contact_email,
    msaUrl: row.msa_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by ?? null,
  }
}

function clientToRow(client) {
  const row = {}
  for (const [field, column] of Object.entries(FIELD_TO_COLUMN)) {
    if (client[field] !== undefined) row[column] = client[field] || null
  }
  return row
}

// ---------- CRUD ----------

/** @returns {Promise<Client[]>} ordenados alfabéticamente por nombre. */
export async function getClients() {
  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 200))
    return [...demoClients].sort((a, b) => a.clientName.localeCompare(b.clientName, 'es'))
  }
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .order('client_name', { ascending: true })
  if (error) throw new Error(error.message)
  return data.map(rowToClient)
}

/**
 * Crea un cliente.
 * @param {Partial<Client>} payload
 * @param {?string} createdBy
 * @returns {Promise<Client>}
 */
export async function createClient(payload, createdBy) {
  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 250))
    const client = {
      id: `cl-demo-${Date.now()}`,
      ...payload,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: createdBy || null,
    }
    demoClients = [client, ...demoClients]
    return client
  }

  const { data, error } = await supabase
    .from('clients')
    .insert({ ...clientToRow(payload), created_by: createdBy || null })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return rowToClient(data)
}

/**
 * Actualiza los datos de un cliente. No hay historial por-campo para
 * clients (a diferencia de projects/project_history) — sí queda versionado
 * el MSA, ver recordClientMsaVersion.
 * @param {Client} current
 * @param {Partial<Client>} updates
 * @param {?string} updatedBy
 * @returns {Promise<Client>}
 */
export async function updateClient(current, updates) {
  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 250))
    const updated = { ...current, ...updates, updatedAt: new Date().toISOString() }
    demoClients = demoClients.map((c) => (c.id === current.id ? updated : c))
    return updated
  }

  const { data, error } = await supabase
    .from('clients')
    .update({ ...clientToRow(updates), updated_at: new Date().toISOString() })
    .eq('id', current.id)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return rowToClient(data)
}

/**
 * Registra una nueva versión del MSA en el historial versionado
 * (project_documents, subject_type='msa') — el archivo anterior nunca se
 * borra, solo deja de ser el `msa_url` vigente del cliente.
 * @param {{ clientId: string|number, fileUrl: string, uploadedBy?: ?string }} params
 */
export async function recordClientMsaVersion({ clientId, fileUrl, uploadedBy }) {
  await recordProjectDocument({ subjectType: 'msa', subjectId: clientId, fileUrl, uploadedBy })
}

/**
 * Sube el MSA (PDF) al bucket de Storage y devuelve el path guardado.
 * Valida MIME (application/pdf) y tamaño (<= 20 MB).
 * @param {File} file
 * @returns {Promise<string>} path en el bucket
 */
export async function uploadClientMsa(file) {
  if (!file) {
    const e = new Error('MSA file is missing.')
    e.code = 'no_file'
    throw e
  }
  if (file.type !== 'application/pdf') {
    const e = new Error('The MSA must be a PDF.')
    e.code = 'bad_type'
    throw e
  }
  if (file.size > MSA_MAX_BYTES) {
    const e = new Error('The MSA cannot exceed 20 MB.')
    e.code = 'too_big'
    throw e
  }

  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 300))
    return `demo/${Date.now()}-${file.name}`
  }

  const path = `${Date.now()}-${file.name}`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: 'application/pdf', upsert: false })
  if (error) throw new Error(error.message)
  return path
}

/** URL firmada (60s) para descargar el MSA de un cliente. */
export async function getClientMsaUrl(msaUrl) {
  if (!msaUrl) return null
  if (!isSupabaseConfigured) return null
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(msaUrl, 60)
  if (error) return null
  return data.signedUrl
}
