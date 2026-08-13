/**
 * Capa de datos — único punto de acceso a las entradas de tiempo, los pagos
 * y la inserción de nuevos pagos. Si hay credenciales de Supabase, lee/escribe
 * en la base real; si no, devuelve datos MOCK para que la app sea navegable en
 * modo demo. Cualquier error de Supabase en lectura también cae a mock.
 *
 * @typedef {Object} TimeEntry
 * @property {string|number} id
 * @property {string} user
 * @property {string} project
 * @property {string} client       Cliente asociado al proyecto (FR-02)
 * @property {string} task
 * @property {string} taskNumber   ID numérico de la tarea en Zoho (FR-02)
 * @property {string} description
 * @property {string} notes
 * @property {string} date      ISO YYYY-MM-DD
 * @property {number} hours
 * @property {'Approved'|'Rejected'} status
 *
 * @typedef {Object} Payment
 * @property {string|number} id
 * @property {string} userName
 * @property {number} totalHours
 * @property {string} invoiceNumber
 * @property {?string} transactionNumber
 * @property {Array<string|number>} entryIds
 * @property {string} createdAt
 *
 * @typedef {Object} Invoice                         FR-05
 * @property {string|number} id
 * @property {string} supplierInvoiceNumber
 * @property {string} invoiceDate                    ISO YYYY-MM-DD
 * @property {number} totalAmount
 * @property {?string} notes
 * @property {string} userName                       contractor
 * @property {Array<string|number>} entryIds
 * @property {'Invoiced'|'Collected'|'Paid'} status
 * @property {string} createdAt
 * @property {?string} createdBy
 */

import { supabase, isSupabaseConfigured } from './supabase'

/** @type {TimeEntry[]} */
const MOCK_TIME_ENTRIES = [
  {
    id: 'te-01',
    user: 'Florencia Sarasúa',
    client: 'HSS',
    taskNumber: '1001',
    project: 'CONTRACT DOMO DEVELOPMENT & IT SUPPORT',
    task: '5 - HSS Data Modeling ETL DOMO',
    description: 'Modelado de datos para el tablero de operaciones',
    notes: 'Validado con el equipo de datos',
    date: '2026-05-04',
    hours: 7.5,
    status: 'Approved',
  },
  {
    id: 'te-02',
    user: 'Florencia Sarasúa',
    client: 'HSS',
    taskNumber: '1002',
    project: 'CONTRACT DOMO DEVELOPMENT & IT SUPPORT',
    task: 'HSS Maintenance ETL/Dashboard',
    description: 'Mantenimiento de los flujos ETL nocturnos',
    notes: '',
    date: '2026-05-08',
    hours: 4,
    status: 'Approved',
  },
  {
    id: 'te-03',
    user: 'Florencia Sarasúa',
    client: 'Acme Analytics',
    taskNumber: '2001',
    project: 'CONTRACT ANALYTICS PLATFORM',
    task: 'API Integration',
    description: 'Integración con la API de facturación',
    notes: 'Pendiente credenciales de producción',
    date: '2026-05-13',
    hours: 6,
    status: 'Approved',
  },
  {
    id: 'te-04',
    user: 'Matías Sarasúa',
    client: 'HSS',
    taskNumber: '1003',
    project: 'CONTRACT DOMO DEVELOPMENT & IT SUPPORT',
    task: '5 - HSS APP Development DOMO',
    description: 'Desarrollo de la vista de aprobaciones',
    notes: 'Revisión de QA agendada',
    date: '2026-05-05',
    hours: 8,
    status: 'Approved',
  },
  {
    id: 'te-05',
    user: 'Matías Sarasúa',
    client: 'HSS',
    taskNumber: '1003',
    project: 'CONTRACT DOMO DEVELOPMENT & IT SUPPORT',
    task: '5 - HSS APP Development DOMO',
    description: 'Corrección de bugs en el módulo de carga',
    notes: 'Reabierto por QA',
    date: '2026-05-11',
    hours: 3.5,
    status: 'Rejected',
  },
  {
    id: 'te-06',
    user: 'Matías Sarasúa',
    client: 'Acme Analytics',
    taskNumber: '2002',
    project: 'CONTRACT ANALYTICS PLATFORM',
    task: 'Development',
    description: 'Componentes de gráficos reutilizables',
    notes: 'Documentado en Storybook',
    date: '2026-05-15',
    hours: 6.5,
    status: 'Approved',
  },
  {
    id: 'te-07',
    user: 'Diego Pérez',
    client: 'Acme Analytics',
    taskNumber: '2001',
    project: 'CONTRACT ANALYTICS PLATFORM',
    task: 'API Integration',
    description: 'Conexión del pipeline de eventos',
    notes: 'Coordinar con infraestructura',
    date: '2026-04-29',
    hours: 9,
    status: 'Approved',
  },
  {
    id: 'te-08',
    user: 'Diego Pérez',
    client: 'Southpoint (interno)',
    taskNumber: '3001',
    project: 'INTERNAL HOURS ALLOCATION',
    task: 'Development',
    description: 'Refactor del servicio de autenticación',
    notes: '',
    date: '2026-05-06',
    hours: 5,
    status: 'Approved',
  },
  {
    id: 'te-09',
    user: 'Diego Pérez',
    client: 'HSS',
    taskNumber: '1002',
    project: 'CONTRACT DOMO DEVELOPMENT & IT SUPPORT',
    task: 'HSS Maintenance ETL/Dashboard',
    description: 'Soporte y monitoreo de dashboards',
    notes: 'Incidente resuelto el mismo día',
    date: '2026-05-12',
    hours: 2,
    status: 'Approved',
  },
  {
    id: 'te-10',
    user: 'Lucía Méndez',
    client: 'HSS',
    taskNumber: '1001',
    project: 'CONTRACT DOMO DEVELOPMENT & IT SUPPORT',
    task: '5 - HSS Data Modeling ETL DOMO',
    description: 'Diseño del modelo dimensional de ventas',
    notes: 'Aprobado por el área de negocio',
    date: '2026-05-07',
    hours: 11,
    status: 'Approved',
  },
  {
    id: 'te-11',
    user: 'Lucía Méndez',
    client: 'Southpoint (interno)',
    taskNumber: '3001',
    project: 'INTERNAL HOURS ALLOCATION',
    task: 'Development',
    description: 'Capacitación interna del equipo',
    notes: 'Fuera del alcance del contrato',
    date: '2026-05-14',
    hours: 1.5,
    status: 'Rejected',
  },
  {
    id: 'te-12',
    user: 'Lucía Méndez',
    client: 'Acme Analytics',
    taskNumber: '2001',
    project: 'CONTRACT ANALYTICS PLATFORM',
    task: 'API Integration',
    description: 'Pruebas de carga sobre los endpoints',
    notes: 'Resultados dentro del SLA',
    date: '2026-05-18',
    hours: 6,
    status: 'Approved',
  },
]

/** @type {Invoice[]} — 2 facturas de ejemplo (FR-05) sobre las mismas entries. */
const MOCK_INVOICES = [
  {
    id: 'inv-mock-1',
    supplierInvoiceNumber: 'FA-0001-00000123',
    invoiceDate: '2026-05-09',
    totalAmount: 1150,
    notes: 'Horas de mayo — primera quincena',
    userName: 'Florencia Sarasúa',
    entryIds: ['te-01', 'te-02'],
    status: 'Collected',
    createdAt: '2026-05-09T10:00:00.000Z',
    createdBy: 'demo@southpoint.local',
  },
  {
    id: 'inv-mock-2',
    supplierInvoiceNumber: 'FA-0001-00000124',
    invoiceDate: '2026-05-10',
    totalAmount: 800,
    notes: null,
    userName: 'Matías Sarasúa',
    entryIds: ['te-04'],
    status: 'Paid',
    createdAt: '2026-05-10T14:30:00.000Z',
    createdBy: 'demo@southpoint.local',
  },
  {
    id: 'inv-mock-3',
    supplierInvoiceNumber: 'FA-0001-00000130',
    invoiceDate: '2026-04-20',
    totalAmount: 650,
    notes: 'Pendiente de cobro',
    userName: 'Matías Sarasúa',
    entryIds: ['te-06'],
    status: 'Invoiced',
    createdAt: '2026-04-20T12:00:00.000Z',
    createdBy: 'demo@southpoint.local',
  },
]

/** @type {Array<{id:string,ranAt:string,status:string,recordsCount:?number,errorMessage:?string}>} */
const MOCK_SYNC_LOG = [
  { id: 'sl-1', ranAt: new Date(Date.now() - 7 * 60 * 1000).toISOString(), status: 'OK', recordsCount: 12, errorMessage: null },
  { id: 'sl-2', ranAt: new Date(Date.now() - 22 * 60 * 1000).toISOString(), status: 'OK', recordsCount: 12, errorMessage: null },
  { id: 'sl-3', ranAt: new Date(Date.now() - 37 * 60 * 1000).toISOString(), status: 'Error', recordsCount: 0, errorMessage: 'HTTP 503 on projectsapi.zoho.com tras 4 intentos' },
  { id: 'sl-4', ranAt: new Date(Date.now() - 52 * 60 * 1000).toISOString(), status: 'OK', recordsCount: 11, errorMessage: null },
]

/** @type {Record<string, Array<object>>} — historial demo de las facturas mock. */
const MOCK_INVOICE_HISTORY = {
  'inv-mock-1': [
    {
      id: 'h-1b',
      fromStatus: 'Invoiced',
      toStatus: 'Collected',
      changedAt: '2026-05-20T11:00:00.000Z',
      changedBy: 'demo@southpoint.local',
      note: 'Collection credited from client',
    },
  ],
  'inv-mock-2': [
    {
      id: 'h-2c',
      fromStatus: 'Collected',
      toStatus: 'Paid',
      changedAt: '2026-05-22T16:30:00.000Z',
      changedBy: 'demo@southpoint.local',
      note: 'Contractor payment completed',
    },
    {
      id: 'h-2b',
      fromStatus: 'Invoiced',
      toStatus: 'Collected',
      changedAt: '2026-05-18T09:15:00.000Z',
      changedBy: 'demo@southpoint.local',
      note: null,
    },
  ],
}

// Normaliza una fila de la tabla `time_entries` al shape que consume la UI.
function rowToEntry(row) {
  return {
    id: row.id,
    user: row.user_name,
    project: row.project ?? '',
    client: row.client ?? '',
    task: row.task ?? '',
    taskNumber: row.task_number ?? '',
    description: row.description ?? '',
    notes: row.notes ?? '',
    date: row.log_date,
    hours: Number(row.hours),
    status: row.status ?? 'Approved',
    // null = sin clasificar (0018). El triage manual vive en Entries; ningún
    // flujo la asigna automáticamente.
    allocation: row.allocation ?? null,
  }
}

// Normaliza una fila de `invoices` al shape de la UI (FR-05).
function rowToInvoice(row) {
  return {
    id: row.id,
    supplierInvoiceNumber: row.supplier_invoice_number,
    invoiceDate: row.invoice_date,
    totalAmount: Number(row.total_amount),
    currency: row.currency ?? 'USD',
    notes: row.notes ?? null,
    userName: row.user_name,
    entryIds: Array.isArray(row.entry_ids) ? row.entry_ids : [],
    status: row.status ?? 'Invoiced',
    paymentTermsDays: row.payment_terms_days ?? 30,
    createdAt: row.created_at,
    createdBy: row.created_by ?? null,
  }
}

/**
 * Devuelve las entradas de tiempo.
 * Lee de Supabase si está configurado; cae a mock si falla o no hay credenciales.
 * @returns {Promise<TimeEntry[]>}
 */
export async function getTimeEntries() {
  if (!isSupabaseConfigured) {
    await new Promise((resolve) => setTimeout(resolve, 450))
    return MOCK_TIME_ENTRIES
  }

  const { data, error } = await supabase
    .from('time_entries')
    .select(
      'id, zoho_log_id, user_name, project, client, task, task_number, description, notes, log_date, hours, status, allocation',
    )
    .order('log_date', { ascending: false })

  if (error) throw new Error(error.message)
  return data.map(rowToEntry)
}

// NOTA: el módulo de Payments al contractor (FR-10) vive en `paymentsData.js`.
// La tabla `payments` se realineó a ese modelo; el código viejo se removió.

/**
 * Devuelve las facturas emitidas (FR-05). Lee de Supabase si está configurado;
 * cae a mock si falla o no hay credenciales.
 * @returns {Promise<Invoice[]>}
 */
export async function getInvoices() {
  if (!isSupabaseConfigured) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    return MOCK_INVOICES
  }

  const { data, error } = await supabase
    .from('invoices')
    .select(
      'id, supplier_invoice_number, invoice_date, total_amount, currency, notes, user_name, entry_ids, status, payment_terms_days, created_at, created_by',
    )
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return data.map(rowToInvoice)
}

/**
 * Emite una factura (INSERT en `invoices`). En modo demo resuelve sin escribir
 * pero devuelve un objeto Invoice local listo para sumarse al estado de la UI.
 *
 * @param {{
 *   supplierInvoiceNumber: string,
 *   invoiceDate: string,
 *   totalAmount: number,
 *   notes?: string,
 *   userName: string,
 *   entryIds: Array<string|number>,
 *   createdBy?: string,
 * }} payload
 * @returns {Promise<{ ok: true, mode: 'supabase'|'demo', invoice: Invoice }>}
 */
export async function createInvoice({
  supplierInvoiceNumber,
  invoiceDate,
  totalAmount,
  currency = 'USD',
  notes,
  userName,
  entryIds,
  createdBy,
}) {
  if (!isSupabaseConfigured) {
    await new Promise((resolve) => setTimeout(resolve, 350))
    const invoice = {
      id: `inv-demo-${Date.now()}`,
      supplierInvoiceNumber,
      invoiceDate,
      totalAmount: Number(totalAmount),
      currency,
      notes: notes || null,
      userName,
      entryIds: [...entryIds],
      status: 'Invoiced',
      createdAt: new Date().toISOString(),
      createdBy: createdBy || null,
    }
    return { ok: true, mode: 'demo', invoice }
  }

  // No hay constraint único en supplier_invoice_number todavía (hay duplicados
  // históricos que requieren revisión manual antes de poder agregarlo), así que
  // se valida acá para bloquear NUEVOS duplicados sin tocar los existentes.
  const { data: existing, error: existingError } = await supabase
    .from('invoices')
    .select('id')
    .eq('supplier_invoice_number', supplierInvoiceNumber)
    .limit(1)
  if (existingError) throw new Error(existingError.message)
  if (existing.length > 0) {
    const err = new Error('That supplier invoice number already exists. Please use a different one.')
    err.code = 'duplicate'
    throw err
  }

  // entry_ids en Supabase es bigint[]; filtramos cualquier id no-numérico.
  const numericIds = entryIds
    .map((id) => (typeof id === 'number' ? id : Number(id)))
    .filter((id) => Number.isFinite(id))

  const { data, error } = await supabase
    .from('invoices')
    .insert({
      supplier_invoice_number: supplierInvoiceNumber,
      invoice_date: invoiceDate,
      total_amount: Number(totalAmount),
      currency,
      notes: notes || null,
      user_name: userName,
      entry_ids: numericIds,
      status: 'Invoiced',
      created_by: createdBy || null,
    })
    .select()
    .single()

  if (error) throw new Error(error.message)
  return { ok: true, mode: 'supabase', invoice: rowToInvoice(data) }
}

/**
 * Ciclo de vida del Billing Status. "Pending" es la ausencia de factura; la
 * columna invoices.status sólo toma estos 3 valores. Transiciones permitidas:
 * Invoiced → Collected → Paid (sin saltos, sin retroceso).
 */
export const BILLING_STATUSES = ['Pending', 'Invoiced', 'Collected', 'Paid']

const VALID_TRANSITIONS = {
  Invoiced: ['Collected'],
  Collected: ['Paid'],
}

/** ¿Se puede pasar `from` → `to`? (no permite saltos ni retrocesos) */
export function isValidTransition(from, to) {
  return (VALID_TRANSITIONS[from] ?? []).includes(to)
}

/** Próximo estado en el ciclo, o null si es terminal / desconocido. */
export function nextBillingStatus(status) {
  return VALID_TRANSITIONS[status]?.[0] ?? null
}

/**
 * Cambia el estado de una factura validando la transición y registrando el
 * cambio en `invoice_status_history`. Lista para usarse en Collections (FR-08)
 * y Payments (FR-10); por ahora se invoca desde el detalle de factura (FR-06).
 *
 * @param {{
 *   invoiceId: string|number,
 *   fromStatus: string,
 *   toStatus: string,
 *   changedBy?: string,
 *   note?: string,
 * }} payload
 * @returns {Promise<{ ok: true, mode: 'supabase'|'demo', invoice: Invoice, historyEntry: object }>}
 */
export async function updateInvoiceStatus({
  invoiceId,
  fromStatus,
  toStatus,
  changedBy,
  note,
}) {
  if (!isValidTransition(fromStatus, toStatus)) {
    throw new Error(
      `Invalid transition: ${fromStatus} → ${toStatus}. ` +
        'Only Invoiced → Collected → Paid is allowed.',
    )
  }

  const changedAt = new Date().toISOString()
  const historyEntry = {
    invoiceId,
    fromStatus,
    toStatus,
    changedAt,
    changedBy: changedBy || null,
    note: note || null,
  }

  if (!isSupabaseConfigured) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    return { ok: true, mode: 'demo', invoice: null, historyEntry }
  }

  // Update con guarda sobre el estado actual (evita carreras / saltos).
  const { data, error } = await supabase
    .from('invoices')
    .update({ status: toStatus })
    .eq('id', invoiceId)
    .eq('status', fromStatus)
    .select()
    .single()

  if (error) throw new Error(error.message)
  if (!data) {
    throw new Error('The invoice status has already changed; please reload and try again.')
  }

  // Registrar la transición en el historial (best-effort: no tumba el cambio).
  const { error: histError } = await supabase
    .from('invoice_status_history')
    .insert({
      invoice_id: invoiceId,
      from_status: fromStatus,
      to_status: toStatus,
      changed_by: changedBy || null,
      note: note || null,
    })
  if (histError) {
    console.warn('[data] updateInvoiceStatus: no se pudo registrar el historial —', histError.message)
  }

  return { ok: true, mode: 'supabase', invoice: rowToInvoice(data), historyEntry }
}

/**
 * Historial de cambios de estado de una factura (más reciente primero).
 * @param {string|number} invoiceId
 * @returns {Promise<Array<{id:any, fromStatus:?string, toStatus:string, changedAt:string, changedBy:?string, note:?string}>>}
 */
export async function getInvoiceStatusHistory(invoiceId) {
  if (!isSupabaseConfigured) {
    await new Promise((resolve) => setTimeout(resolve, 150))
    return MOCK_INVOICE_HISTORY[invoiceId] ?? []
  }
  const { data, error } = await supabase
    .from('invoice_status_history')
    .select('id, from_status, to_status, changed_at, changed_by, note')
    .eq('invoice_id', invoiceId)
    .order('changed_at', { ascending: false })

  if (error) {
    console.warn('[data] getInvoiceStatusHistory: Supabase falló —', error.message)
    return []
  }
  return data.map((row) => ({
    id: row.id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    changedAt: row.changed_at,
    changedBy: row.changed_by,
    note: row.note,
  }))
}

/**
 * Dispara on-demand el sync de Zoho (Edge Function `sync-time-logs`). El cron
 * sigue corriendo cada 15 min; esto es para forzar una actualización manual.
 *
 * @returns {Promise<{ ok: true, mode: 'supabase'|'demo', synced: number|null }>}
 */
export async function triggerSync() {
  if (!isSupabaseConfigured) {
    await new Promise((resolve) => setTimeout(resolve, 600))
    return { ok: true, mode: 'demo', synced: 0 }
  }

  const { data, error } = await supabase.functions.invoke('sync-time-logs')
  if (error) throw new Error(error.message)
  // La Edge Function ahora devuelve { ok:false, error } (HTTP 200) si Zoho falló
  // tras los reintentos, en lugar de crashear. Lo propagamos como excepción para
  // que la UI muestre el toast de error.
  if (data && data.ok === false) {
    throw new Error(data.error || 'Could not sync with Zoho.')
  }
  return { ok: true, mode: 'supabase', synced: data?.synced ?? null }
}

/**
 * Estado del último sync (tabla `sync_status`, fila singleton id=1).
 * @typedef {Object} SyncStatus
 * @property {?string} lastSyncedAt
 * @property {?string} lastStatus            'OK' | 'Error'
 * @property {?number} lastRecordsCount
 * @property {?string} lastErrorMessage
 *
 * @returns {Promise<SyncStatus|null>}
 */
export async function getSyncStatus() {
  if (!isSupabaseConfigured) {
    return {
      lastSyncedAt: new Date(Date.now() - 7 * 60 * 1000).toISOString(),
      lastStatus: 'OK',
      lastRecordsCount: MOCK_TIME_ENTRIES.length,
      lastErrorMessage: null,
    }
  }

  const { data, error } = await supabase
    .from('sync_status')
    .select('last_synced_at, last_status, last_records_count, last_error_message')
    .eq('id', 1)
    .maybeSingle()

  if (error) {
    console.warn('[data] getSyncStatus: Supabase falló —', error.message)
    return null
  }
  if (!data) return null
  return {
    lastSyncedAt: data.last_synced_at,
    lastStatus: data.last_status,
    lastRecordsCount: data.last_records_count,
    lastErrorMessage: data.last_error_message,
  }
}

/**
 * Historial de corridas del sync (tabla `sync_log`), más recientes primero.
 * @typedef {Object} SyncLogEntry
 * @property {string|number} id
 * @property {string} ranAt
 * @property {string} status               'OK' | 'Error'
 * @property {?number} recordsCount
 * @property {?string} errorMessage
 *
 * @param {number} [limit=50]
 * @returns {Promise<SyncLogEntry[]>}
 */
export async function getSyncLog(limit = 50) {
  if (!isSupabaseConfigured) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    return MOCK_SYNC_LOG
  }

  const { data, error } = await supabase
    .from('sync_log')
    .select('id, ran_at, status, records_count, error_message')
    .order('ran_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.warn('[data] getSyncLog: Supabase falló —', error.message)
    return []
  }
  return data.map((row) => ({
    id: row.id,
    ranAt: row.ran_at,
    status: row.status,
    recordsCount: row.records_count,
    errorMessage: row.error_message,
  }))
}
