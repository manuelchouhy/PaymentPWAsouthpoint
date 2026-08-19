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
import { logAudit } from './auditData'
import { demoDate, demoTimestamp } from './demoDates'

/** @type {TimeEntry[]} */
const MOCK_TIME_ENTRIES = [
  {
    id: 'te-01',
    user: 'Florencia Sarasúa',
    client: 'HSS',
    taskNumber: '1001',
    project: 'DOMO Development & IT Support',
    task: '5 - HSS Data Modeling ETL DOMO',
    description: 'Modelado de datos para el tablero de operaciones',
    notes: 'Validado con el equipo de datos',
    date: demoDate(-17),
    hours: 7.5,
    status: 'Approved',
    allocation: 'bill_to_client',
  },
  {
    id: 'te-02',
    user: 'Florencia Sarasúa',
    client: 'HSS',
    taskNumber: '1002',
    project: 'DOMO Development & IT Support',
    task: 'HSS Maintenance ETL/Dashboard',
    description: 'Mantenimiento de los flujos ETL nocturnos',
    notes: '',
    date: demoDate(-13),
    hours: 4,
    // allocation null a propósito, y esta entry ESTÁ facturada (inv-mock-1):
    // reproduce la hora anterior al triage que existe en producción. Es el
    // único fixture que distingue el cálculo correcto de las tarjetas de
    // facturado del bug que las dejaba en cero — sin ella, revertir ese fix no
    // cambia ningún número del demo ni rompe ningún test.
    allocation: null,
    status: 'Approved',
  },
  {
    id: 'te-03',
    user: 'Florencia Sarasúa',
    client: 'Acme Analytics',
    taskNumber: '2001',
    project: 'Analytics Platform',
    task: 'API Integration',
    description: 'Integración con la API de facturación',
    notes: 'Pendiente credenciales de producción',
    date: demoDate(-8),
    hours: 6,
    status: 'Approved',
    allocation: 'bill_to_client',
  },
  {
    id: 'te-04',
    user: 'Matías Sarasúa',
    client: 'HSS',
    taskNumber: '1003',
    project: 'DOMO Development & IT Support',
    task: '5 - HSS APP Development DOMO',
    description: 'Desarrollo de la vista de aprobaciones',
    notes: 'Revisión de QA agendada',
    date: demoDate(-16),
    hours: 8,
    status: 'Approved',
    allocation: 'bill_to_client',
  },
  {
    id: 'te-05',
    user: 'Matías Sarasúa',
    client: 'HSS',
    taskNumber: '1003',
    project: 'DOMO Development & IT Support',
    task: '5 - HSS APP Development DOMO',
    description: 'Corrección de bugs en el módulo de carga',
    notes: 'Reabierto por QA',
    date: demoDate(-10),
    hours: 3.5,
    status: 'Rejected',
    allocation: null,
  },
  {
    id: 'te-06',
    user: 'Matías Sarasúa',
    client: 'Acme Analytics',
    taskNumber: '2002',
    project: 'Analytics Platform',
    task: 'Development',
    description: 'Componentes de gráficos reutilizables',
    notes: 'Documentado en Storybook',
    date: demoDate(-6),
    hours: 6.5,
    status: 'Approved',
    allocation: 'bill_to_client',
  },
  {
    id: 'te-07',
    user: 'Diego Pérez',
    client: 'Acme Analytics',
    taskNumber: '2001',
    project: 'Analytics Platform',
    task: 'API Integration',
    description: 'Conexión del pipeline de eventos',
    notes: 'Coordinar con infraestructura',
    date: demoDate(-22),
    hours: 9,
    status: 'Approved',
    allocation: 'overage',
  },
  {
    id: 'te-08',
    user: 'Diego Pérez',
    client: 'Southpoint (interno)',
    taskNumber: '3001',
    project: 'Internal Hours Allocation',
    task: 'Development',
    description: 'Refactor del servicio de autenticación',
    notes: '',
    date: demoDate(-15),
    hours: 5,
    status: 'Approved',
    allocation: 'sp_internal',
  },
  {
    id: 'te-09',
    user: 'Diego Pérez',
    client: 'HSS',
    taskNumber: '1002',
    project: 'DOMO Development & IT Support',
    task: 'HSS Maintenance ETL/Dashboard',
    description: 'Soporte y monitoreo de dashboards',
    notes: 'Incidente resuelto el mismo día',
    date: demoDate(-9),
    hours: 2,
    status: 'Approved',
    allocation: 'bill_to_client',
  },
  {
    id: 'te-10',
    user: 'Lucía Méndez',
    client: 'HSS',
    taskNumber: '1001',
    project: 'DOMO Development & IT Support',
    task: '5 - HSS Data Modeling ETL DOMO',
    description: 'Diseño del modelo dimensional de ventas',
    notes: 'Aprobado por el área de negocio',
    date: demoDate(-14),
    hours: 11,
    status: 'Approved',
    allocation: 'overage',
  },
  {
    id: 'te-11',
    user: 'Lucía Méndez',
    client: 'Southpoint (interno)',
    taskNumber: '3001',
    project: 'Internal Hours Allocation',
    task: 'Development',
    description: 'Capacitación interna del equipo',
    notes: 'Fuera del alcance del contrato',
    date: demoDate(-7),
    hours: 1.5,
    status: 'Rejected',
    allocation: null,
  },
  {
    id: 'te-12',
    user: 'Lucía Méndez',
    client: 'Acme Analytics',
    taskNumber: '2001',
    project: 'Analytics Platform',
    task: 'API Integration',
    description: 'Pruebas de carga sobre los endpoints',
    notes: 'Resultados dentro del SLA',
    date: demoDate(-3),
    hours: 6,
    status: 'Approved',
    allocation: 'bill_to_client',
  },
]

/** @type {Invoice[]} — 2 facturas de ejemplo (FR-05) sobre las mismas entries. */
const MOCK_INVOICES = [
  {
    id: 'inv-mock-1',
    supplierInvoiceNumber: 'FA-0001-00000123',
    invoiceDate: demoDate(-11),
    totalAmount: 1150,
    notes: 'Horas de mayo — primera quincena',
    userName: 'Florencia Sarasúa',
    entryIds: ['te-01', 'te-02'],
    status: 'Collected',
    createdAt: demoTimestamp(-11),
    createdBy: 'demo@southpoint.local',
  },
  {
    id: 'inv-mock-2',
    supplierInvoiceNumber: 'FA-0001-00000124',
    invoiceDate: demoDate(-10),
    totalAmount: 800,
    notes: null,
    userName: 'Matías Sarasúa',
    entryIds: ['te-04'],
    status: 'Paid',
    createdAt: demoTimestamp(-10),
    createdBy: 'demo@southpoint.local',
  },
  {
    id: 'inv-mock-3',
    supplierInvoiceNumber: 'FA-0001-00000130',
    invoiceDate: demoDate(-4),
    totalAmount: 650,
    notes: 'Pendiente de cobro',
    userName: 'Matías Sarasúa',
    entryIds: ['te-06'],
    status: 'Invoiced',
    createdAt: demoTimestamp(-4),
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
      changedAt: demoTimestamp(-6),
      changedBy: 'demo@southpoint.local',
      note: 'Collection credited from client',
    },
  ],
  'inv-mock-2': [
    {
      id: 'h-2c',
      fromStatus: 'Collected',
      toStatus: 'Paid',
      changedAt: demoTimestamp(-4),
      changedBy: 'demo@southpoint.local',
      note: 'Contractor payment completed',
    },
    {
      id: 'h-2b',
      fromStatus: 'Invoiced',
      toStatus: 'Collected',
      changedAt: demoTimestamp(-7),
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
    // Id de Zoho del proyecto: llave hora→proyecto robusta a renames, la consume
    // deriveEntriesClient (slice 3). Null en filas viejas hasta el próximo sync.
    zohoProjectId: row.zoho_project_id ?? null,
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

// `.in()` viaja en la query string: una selección de "todas" sobre 500+ filas
// arma una URI de varios KB que el servidor rechaza con 414 antes de mirar el
// dominio. Se parte en tandas.
const ID_CHUNK = 200

function chunkIds(ids) {
  const chunks = []
  for (let i = 0; i < ids.length; i += ID_CHUNK) chunks.push(ids.slice(i, i + ID_CHUNK))
  return chunks
}

/**
 * Ids de entries que ya salieron en una factura, releídos de la base. La UI
 * decide qué checkbox habilita con los datos que cargó al montar; si mientras
 * tanto se emitió una factura en otra sesión, ese cache quedó viejo y sólo
 * esta relectura lo detecta.
 *
 * Congela cualquier entry que aparezca en una factura, sin mirar su status:
 * `invoices.status` sólo admite Invoiced/Collected/Paid (0003), y "Pending"
 * es el estado sintético que la UI muestra cuando NO hay factura. Filtrar por
 * `status != 'Pending'` acá parecería más estricto y no filtraría nada.
 */
async function getFrozenEntryIds(entryIds) {
  // entry_ids es bigint[]: un id no numérico no puede estar ahí (mismo criterio
  // que createInvoice).
  const numericIds = entryIds.map(Number).filter((n) => Number.isFinite(n))
  const frozen = new Set()
  if (!numericIds.length) return frozen

  for (const chunk of chunkIds(numericIds)) {
    const { data, error } = await supabase
      .from('invoices')
      .select('entry_ids')
      .overlaps('entry_ids', chunk)
    if (error) throw new Error(error.message)
    for (const row of data) {
      for (const id of row.entry_ids ?? []) frozen.add(String(id))
    }
  }
  return frozen
}

/**
 * Clasifica horas (triage de Entries): asigna la misma allocation a todas las
 * entries seleccionadas de una. Es la ÚNICA forma de tocar `allocation` — la
 * grilla nunca la edita por click en la celda, porque define quién paga esas
 * horas.
 *
 * No toca entries ya facturadas: la UI deshabilita su checkbox, pero lo hace
 * contra los datos que cargó al montar, así que acá se revalida contra la base
 * — una allocation cambiada después de facturar desalinearía la factura de su
 * justificación.
 *
 * Devolver sólo los ids escritos no alcanza: quedarse corto porque una hora ya
 * estaba facturada (definitivo, no hay nada que reintentar) y quedarse corto
 * porque una tanda falló (transitorio, reintentable) son cosas distintas y la
 * UI tiene que poder decir cuál fue. Por eso el resultado las separa en vez de
 * dejar que el llamador adivine restando.
 *
 * @param {Array<string|number>} entryIds
 * @param {'bill_to_client'|'overage'|'sp_internal'|null} allocation  null =
 *   vuelve a "sin clasificar" (el "— sin clasificar" del dropdown de Apply). El
 *   CHECK de la base admite null sin migración.
 * @param {?string} changedBy
 * Los tres motivos por los que una entry pedida puede no aparecer en
 * `updatedIds` piden mensajes distintos: `skippedFrozen` (ya facturada: nunca
 * se va a poder), `failures` (la tanda falló: reintentable) y `unconfirmed`
 * (la base aceptó el pedido y no devolvió la fila: se perdió en silencio).
 *
 * @returns {Promise<{updatedIds: Array<string|number>, skippedFrozen: number, failures: string[], unconfirmed: number}>}
 */
export async function setEntriesAllocation(entryIds, allocation, changedBy) {
  if (!entryIds?.length) return { updatedIds: [], skippedFrozen: 0, failures: [], unconfirmed: 0 }

  if (!isSupabaseConfigured) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    // Mutar el mock: sin esto la grilla muestra el cambio, y en el próximo
    // Retry la clasificación desaparece — en una demo se lee como pérdida de
    // datos, no como modo mock.
    const wanted = new Set(entryIds.map(String))
    const frozenMock = new Set(
      MOCK_INVOICES.flatMap((inv) => (inv.entryIds ?? []).map(String)),
    )
    const updated = []
    for (const entry of MOCK_TIME_ENTRIES) {
      const id = String(entry.id)
      if (!wanted.has(id) || frozenMock.has(id)) continue
      entry.allocation = allocation
      updated.push(entry.id)
    }
    const skippedFrozen = [...wanted].filter((id) => frozenMock.has(id)).length
    return { updatedIds: updated, skippedFrozen, failures: [], unconfirmed: 0 }
  }

  const frozen = await getFrozenEntryIds(entryIds)
  const allowed = entryIds.filter((id) => !frozen.has(String(id)))
  const skippedFrozen = entryIds.length - allowed.length
  if (!allowed.length) return { updatedIds: [], skippedFrozen, failures: [], unconfirmed: 0 }

  // Allocations previas para el audit: sin el `before`, una reclasificación
  // discutida no se puede reconstruir — y esto define quién paga esas horas.
  const previous = new Map()
  for (const chunk of chunkIds(allowed)) {
    const { data, error } = await supabase
      .from('time_entries')
      .select('id, allocation')
      .in('id', chunk)
    if (error) throw new Error(error.message)
    for (const row of data) previous.set(String(row.id), row.allocation ?? null)
  }

  // Cada tanda es un PATCH independiente: no hay transacción que las agrupe.
  // Si la tercera falla, las dos primeras YA se escribieron, así que cortar con
  // una excepción reportaría "no se aplicó nada" sobre filas que sí cambiaron
  // y —peor— se saltearía el audit de esa plata ya movida. Se acumula el error
  // y se sigue: el resultado dice la verdad de lo que quedó escrito.
  const updatedIds = []
  const failures = []
  let failedCount = 0
  // Ids que una tanda SIN error igual no devolvió: PostgREST responde 200 con
  // las filas que pasaron RLS, así que una fila filtrada se ve idéntica a una
  // que no existe. Contarlas aparte es lo único que separa "se guardó" de "se
  // perdió en silencio" cuando el resto de la tanda sí entró.
  let unconfirmedIds = []
  for (const chunk of chunkIds(allowed)) {
    const { data, error } = await supabase
      .from('time_entries')
      .update({ allocation })
      .in('id', chunk)
      .select('id')
    if (error) {
      // Se guardan todos, no sólo el último: dos tandas pueden fallar por
      // motivos distintos (permisos y timeout) y el audit tiene que mostrarlo.
      failures.push(error.message)
      failedCount += chunk.length
      console.error('Falló una tanda de allocation:', error.message)
      continue
    }
    const returned = new Set(data.map((row) => String(row.id)))
    for (const row of data) updatedIds.push(row.id)
    for (const id of chunk) if (!returned.has(String(id))) unconfirmedIds.push(id)
  }

  // Una entry puede haberse facturado entre el chequeo inicial y el UPDATE: con
  // 0029 la policy la filtra, y llega hasta acá como "no confirmada". Antes de
  // culpar a los permisos se relee — decirle "reintentá" a alguien por horas
  // que ya nunca van a ser escribibles es mandarlo a chocar contra una pared.
  let frozenLate = 0
  if (unconfirmedIds.length) {
    // Este chequeo es informativo y corre DESPUÉS de haber escrito: si falla,
    // no puede tumbar la función. Dejarlo propagar perdería el audit de horas
    // ya reclasificadas y le diría al usuario "no se cambió nada" sobre un
    // update que sí entró. Sin respuesta, esos ids quedan sin explicar.
    try {
      const frozenNow = await getFrozenEntryIds(unconfirmedIds)
      const stillUnexplained = unconfirmedIds.filter((id) => !frozenNow.has(String(id)))
      frozenLate = unconfirmedIds.length - stillUnexplained.length
      unconfirmedIds = stillUnexplained
    } catch (error) {
      console.warn('No se pudo releer las facturas para explicar el faltante:', error.message)
    }
  }
  const frozenTotal = skippedFrozen + frozenLate

  if (!updatedIds.length) {
    // Ni siquiera acá se tira excepción: que no se haya escrito nada no borra
    // el hecho de que 40 de las 250 pedidas estaban facturadas. Una excepción
    // se lleva puestos los contadores y deja al usuario reintentando horas que
    // nunca van a ser escribibles, que es justo la confusión que este módulo
    // existe para evitar. El llamador arma el mensaje por motivo y relee.
    if (unconfirmedIds.length && !failures.length) {
      console.error(
        'El update no alcanzó ninguna fila y no hay factura que lo explique:',
        unconfirmedIds.length,
        'entries — revisar permisos o sesión.',
      )
    }
    return {
      updatedIds: [],
      skippedFrozen: frozenTotal,
      failures,
      unconfirmed: unconfirmedIds.length,
    }
  }

  await logAudit({
    actorEmail: changedBy,
    action: 'entries.allocate',
    resourceType: 'time_entries',
    resourceId: null,
    before: {
      entries: updatedIds.map((id) => ({ id, allocation: previous.get(String(id)) ?? null })),
    },
    after: {
      allocation,
      entryIds: updatedIds,
      entryCount: updatedIds.length,
      // Deja rastro de que el bloque pedido no entró entero, para que el log no
      // parezca una clasificación prolija cuando fue parcial.
      ...(frozenTotal ? { skippedFrozen: frozenTotal } : {}),
      ...(failures.length
        ? { failedChunks: failures.length, failedCount, partialFailures: failures }
        : {}),
      ...(unconfirmedIds.length ? { unconfirmed: unconfirmedIds.length } : {}),
    },
  })
  return {
    updatedIds,
    skippedFrozen: frozenTotal,
    failures,
    unconfirmed: unconfirmedIds.length,
  }
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
