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
import { recordProjectDocument, getProjects } from './projectsData'
import { normalizeClientKey } from './clientResolver'

const BUCKET = 'client-msa'
const MSA_MAX_BYTES = 20 * 1024 * 1024 // 20 MB

const FIELD_TO_COLUMN = {
  clientName: 'client_name',
  email: 'email',
  domain: 'domain',
  primaryContactName: 'primary_contact_name',
  primaryContactEmail: 'primary_contact_email',
  msaUrl: 'msa_url',
  // Alias: el nombre del Project Group de Zoho que mapea a este cliente (ej. grupo
  // "HSS" → cliente "HSSStaffing"). Único case-insensitive entre los no nulos
  // (índice clients_zoho_group_name_key). '' → null vía clientToRow.
  zohoGroupName: 'zoho_group_name',
}

// El índice único de la 0030 (clients_zoho_group_name_key) rechaza dos clientes con
// el MISMO alias, pero como backstop de carrera: la validación de abajo ya ataja el
// caso común antes de tocar la base. Se matchea el nombre del índice en el mensaje
// crudo de Postgres para traducirlo a algo legible.
const ALIAS_UNIQUE_INDEX = 'clients_zoho_group_name_key'
function friendlyClientError(error) {
  const msg = String(error?.message ?? error)
  if (error?.code === '23505' && msg.includes(ALIAS_UNIQUE_INDEX)) {
    return new Error('That Zoho group alias is already assigned to another client.')
  }
  return new Error(msg)
}

// Valida que el alias no colisione —normalizado— con el NOMBRE o el alias de OTRO
// cliente. El índice de la 0030 sólo cuida alias-vs-alias, pero buildClientResolver
// arma su índice con clientName Y zohoGroupName: un alias igual al nombre de otro
// cliente no dispara error en la base, pero vuelve ambigua esa clave y rompe la
// resolución grupo→cliente de AMBOS en silencio. Se ataja acá, en los dos modos
// (Supabase y demo), con un mensaje claro. La carrera (dos altas simultáneas) la
// cubre el índice único para alias-vs-alias; el resto es de baja probabilidad.
async function assertAliasFree(alias, selfId) {
  const key = normalizeClientKey(alias)
  if (!key) return
  let others
  if (isSupabaseConfigured) {
    const { data, error } = await supabase.from('clients').select('id, client_name, zoho_group_name')
    // Fail-closed: si no se puede leer para validar, NO se escribe (un `?? []`
    // dejaría pasar el alias sin chequear la colisión que el índice no cubre).
    if (error) throw new Error(`Could not validate the alias: ${error.message}`)
    others = data ?? []
  } else {
    others = demoClients.map((c) => ({ id: c.id, client_name: c.clientName, zoho_group_name: c.zohoGroupName ?? null }))
  }
  for (const c of others) {
    if (String(c.id) === String(selfId)) continue
    const collides =
      normalizeClientKey(c.client_name) === key ||
      (c.zoho_group_name && normalizeClientKey(c.zoho_group_name) === key)
    if (collides) {
      throw new Error(
        `That Zoho group alias collides with client "${c.client_name}". Aliases must be unique across client names and aliases.`,
      )
    }
  }
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
    zohoGroupName: row.zoho_group_name ?? null,
    // true = auto-creado por el sync desde un grupo de Zoho, datos a completar.
    needsReview: row.needs_review ?? false,
    // false = cliente desactivado (borrado lógico). getClients sólo trae activos.
    active: row.active ?? true,
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

/**
 * Clientes ACTIVOS, ordenados alfabéticamente por nombre. Los desactivados
 * (borrado lógico) no se listan ni participan de la resolución grupo→cliente.
 * @returns {Promise<Client[]>}
 */
export async function getClients() {
  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 200))
    return [...demoClients]
      .filter((c) => c.active !== false)
      .sort((a, b) => a.clientName.localeCompare(b.clientName, 'es'))
  }
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('active', true)
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
  await assertAliasFree(payload.zohoGroupName, null)
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
  if (error) throw friendlyClientError(error)
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
  // Sólo se valida si el alias (normalizado) cambió: editar otros campos no
  // necesita re-escanear la tabla de clientes.
  if (normalizeClientKey(updates.zohoGroupName) !== normalizeClientKey(current.zohoGroupName)) {
    await assertAliasFree(updates.zohoGroupName, current.id)
  }
  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 250))
    // needsReview: false igual que el backend real (guardar = revisado).
    const updated = { ...current, ...updates, needsReview: false, updatedAt: new Date().toISOString() }
    demoClients = demoClients.map((c) => (c.id === current.id ? updated : c))
    return updated
  }

  const { data, error } = await supabase
    .from('clients')
    // Guardar una edición manual limpia needs_review: el usuario ya revisó/completó
    // el cliente auto-creado (no está en FIELD_TO_COLUMN a propósito — sólo lo baja
    // el sistema, nunca lo sube el form).
    .update({ ...clientToRow(updates), needs_review: false, updated_at: new Date().toISOString() })
    .eq('id', current.id)
    .select()
    .single()
  if (error) throw friendlyClientError(error)
  return rowToClient(data)
}

/**
 * DESACTIVA un cliente (borrado lógico, definido en la reunión: no borrar
 * información de la base). No elimina la fila: pone active=false, con lo que el
 * cliente sale de getClients (listas + resolución grupo→cliente) pero sus datos,
 * MSA e historial quedan intactos.
 *
 * Bloqueo: no se puede desactivar un cliente que todavía tenga proyectos
 * vinculados (client_id) — primero se reasignan o quitan esos proyectos. Se lanza
 * un error con code 'has_projects' y la cantidad, para que la UI lo explique.
 * @param {{ id: string|number }} client
 * @returns {Promise<{ id: string|number }>}
 */
export async function deactivateClient(client) {
  const projectCount = await countLinkedProjects(client.id)
  if (projectCount > 0) {
    const err = new Error(
      `This client still has ${projectCount} linked project(s). Reassign or remove them before deactivating.`,
    )
    err.code = 'has_projects'
    throw err
  }

  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 250))
    demoClients = demoClients.map((c) =>
      String(c.id) === String(client.id) ? { ...c, active: false } : c,
    )
    return { id: client.id }
  }
  // .select(): un update que matchea 0 filas (RLS que lo bloquea, id inexistente)
  // devuelve { error: null } → sin verificar, la UI reportaría una desactivación
  // que nunca pasó. Se exige que vuelva la fila.
  const { data, error } = await supabase
    .from('clients')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', client.id)
    .select('id')
  if (error) throw friendlyClientError(error)
  if (!data || data.length === 0) {
    throw new Error('The client was not deactivated — it may no longer exist or you may not have permission.')
  }
  return { id: client.id }
}

/** Cantidad de proyectos vinculados (client_id) a este cliente. */
async function countLinkedProjects(clientId) {
  if (!isSupabaseConfigured) {
    const projects = await getProjects()
    return projects.filter((p) => String(p.clientId) === String(clientId)).length
  }
  const { count, error } = await supabase
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
  if (error) throw new Error(`Could not check linked projects: ${error.message}`)
  return count ?? 0
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
