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
 * @property {string} task
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
 */

import { supabase, isSupabaseConfigured } from './supabase'

/** @type {TimeEntry[]} */
const MOCK_TIME_ENTRIES = [
  {
    id: 'te-01',
    user: 'Florencia Sarasúa',
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
    project: 'CONTRACT ANALYTICS PLATFORM',
    task: 'API Integration',
    description: 'Pruebas de carga sobre los endpoints',
    notes: 'Resultados dentro del SLA',
    date: '2026-05-18',
    hours: 6,
    status: 'Approved',
  },
]

/** @type {Payment[]} — 2 pagos de ejemplo cubriendo distintos proveedores */
const MOCK_PAYMENTS = [
  {
    id: 'pm-mock-1',
    userName: 'Florencia Sarasúa',
    totalHours: 11.5,
    invoiceNumber: 'FA-0001-00000123',
    transactionNumber: null,
    entryIds: ['te-01', 'te-02'],
    createdAt: '2026-05-09T10:00:00.000Z',
  },
  {
    id: 'pm-mock-2',
    userName: 'Matías Sarasúa',
    totalHours: 8,
    invoiceNumber: 'FA-0001-00000124',
    transactionNumber: 'TRX-00891',
    entryIds: ['te-04'],
    createdAt: '2026-05-10T14:30:00.000Z',
  },
]

// Normaliza una fila de la tabla `time_entries` al shape que consume la UI.
function rowToEntry(row) {
  return {
    id: row.id,
    user: row.user_name,
    project: row.project ?? '',
    task: row.task ?? '',
    description: row.description ?? '',
    notes: row.notes ?? '',
    date: row.log_date,
    hours: Number(row.hours),
    status: row.status ?? 'Approved',
  }
}

// Normaliza una fila de `payments` al shape de la UI.
function rowToPayment(row) {
  return {
    id: row.id,
    userName: row.user_name,
    totalHours: Number(row.total_hours),
    invoiceNumber: row.invoice_number,
    transactionNumber: row.transaction_number,
    entryIds: Array.isArray(row.entry_ids) ? row.entry_ids : [],
    createdAt: row.created_at,
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
      'id, zoho_log_id, user_name, project, task, description, notes, log_date, hours, status',
    )
    .order('log_date', { ascending: false })

  if (error) {
    console.warn('[data] getTimeEntries: Supabase falló, usando mock —', error.message)
    return MOCK_TIME_ENTRIES
  }
  return data.map(rowToEntry)
}

/**
 * Devuelve los pagos registrados.
 * Lee de Supabase si está configurado; cae a mock si falla o no hay credenciales.
 * @returns {Promise<Payment[]>}
 */
export async function getPayments() {
  if (!isSupabaseConfigured) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    return MOCK_PAYMENTS
  }

  const { data, error } = await supabase
    .from('payments')
    .select('id, user_name, total_hours, invoice_number, transaction_number, entry_ids, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    console.warn('[data] getPayments: Supabase falló, usando mock —', error.message)
    return MOCK_PAYMENTS
  }
  return data.map(rowToPayment)
}

/**
 * Registra un pago en la tabla `payments`. En modo demo resuelve sin escribir,
 * pero devuelve un objeto Payment local listo para sumarse al estado de la UI
 * (así las filas pagadas se marcan sin recargar).
 *
 * @param {{ userName: string, totalHours: number, invoiceNumber: string, transactionNumber?: string, entryIds: Array<string|number> }} payload
 * @returns {Promise<{ ok: true, mode: 'supabase'|'demo', payment: Payment }>}
 */
export async function createPayment({
  userName,
  totalHours,
  invoiceNumber,
  transactionNumber,
  entryIds,
}) {
  if (!isSupabaseConfigured) {
    await new Promise((resolve) => setTimeout(resolve, 350))
    const payment = {
      id: `pm-demo-${Date.now()}`,
      userName,
      totalHours,
      invoiceNumber,
      transactionNumber: transactionNumber || null,
      entryIds: [...entryIds],
      createdAt: new Date().toISOString(),
    }
    return { ok: true, mode: 'demo', payment }
  }

  // entry_ids en Supabase es bigint[]; filtramos cualquier id no-numérico.
  const numericIds = entryIds
    .map((id) => (typeof id === 'number' ? id : Number(id)))
    .filter((id) => Number.isFinite(id))

  const { data, error } = await supabase
    .from('payments')
    .insert({
      user_name: userName,
      total_hours: totalHours,
      invoice_number: invoiceNumber,
      transaction_number: transactionNumber || null,
      entry_ids: numericIds,
    })
    .select()
    .single()

  if (error) throw new Error(error.message)
  return { ok: true, mode: 'supabase', payment: rowToPayment(data) }
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
  return { ok: true, mode: 'supabase', synced: data?.synced ?? null }
}
