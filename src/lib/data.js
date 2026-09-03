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
 * @property {'Approved'|'Rejected'|'Pending'} status  approval_status de Zoho
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
import { buildGroupedInvoicePayload } from './invoiceContractors'

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
  {
    // Hora aún sin aprobar en Zoho (approval_status = Pending): sin clasificar y
    // sin facturar. Existe para que el modo demo muestre el tercer estado del
    // badge y la opción "Pending" del filtro de Status tenga al menos una fila.
    id: 'te-13',
    user: 'Diego Pérez',
    client: 'Acme Analytics',
    taskNumber: '2002',
    project: 'Analytics Platform',
    task: 'Development',
    description: 'Ajustes de UI pendientes de revisión',
    notes: 'A la espera de aprobación del líder',
    date: demoDate(-2),
    hours: 4,
    status: 'Pending',
    allocation: null,
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

// Demo (sin Supabase): filas `invoice_contractors` de las facturas mock. Sin esto,
// getInvoiceContractors devolvería [] y Payments ocultaría toda factura Invoiced (que
// se expande a sus contractors). Una fila por factura (single-contractor); las Paid ya
// vienen con payment_id para mostrarse pagas. Se completa al emitir en demo.
const mockEntryHours = new Map(MOCK_TIME_ENTRIES.map((e) => [e.id, Number(e.hours) || 0]))
let demoInvoiceContractors = MOCK_INVOICES.map((inv) => ({
  id: `${inv.id}-c1`,
  invoiceId: inv.id,
  contractor: inv.userName,
  entryIds: [...inv.entryIds],
  hours: inv.entryIds.reduce((s, id) => s + (mockEntryHours.get(id) || 0), 0),
  supplierInvoiceNumber: inv.status === 'Paid' ? 'SUP-DEMO-0001' : null,
  paymentDate: inv.status === 'Paid' ? inv.invoiceDate : null,
  paymentId: inv.status === 'Paid' ? 'pay-1' : null,
}))

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
    // Modelo multi-contractor (migración 0039): la unidad facturable pasa a ser
    // Cliente + Proyecto + Semana y el número propio de SouthPoint (SP invoice
    // number) vive en su columna. Lecturas tolerantes: null en las facturas
    // legacy (single-contractor), que no tienen estas columnas cargadas.
    spInvoiceNumber: row.sp_invoice_number ?? null,
    project: row.project ?? null,
    client: row.client ?? null,
    weekStart: row.week_start ?? null,
    invoiceDate: row.invoice_date,
    // Modelo en HORAS (slice 04d/05): la factura ya no lleva monto/moneda. El total
    // se deriva de las horas de sus `invoice_contractors`. Las columnas total_amount/
    // currency se dropean en la migración 0041; acá ya no se leen. Se dejan explícitos
    // en `null` (no ausentes) para que la página Collections —fuera de uso y a
    // decomisionar junto con 0041; ver open items— degrade a 0 en vez de romper con NaN.
    totalAmount: null,
    currency: null,
    notes: row.notes ?? null,
    // Legacy single-contractor: la columna user_name no se dropea (0039 sólo la relaja
    // a nullable); en el modelo agrupado viene NULL (el contractor vive en la hija).
    userName: row.user_name ?? null,
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
    // zoho_project_id habilita el join hora→proyecto por id de Zoho en
    // deriveEntriesClient (la columna la crea la migración 0030, ya aplicada).
    .select(
      'id, zoho_log_id, user_name, project, zoho_project_id, client, task, task_number, description, notes, log_date, hours, status, allocation',
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
 * @param {'bill_to_client'|'overage'|'sp_internal'|'unknown'|null} allocation
 *   'unknown' = la categoría X (allocation real desde el CHECK 0034). null =
 *   "sin clasificar" (el CHECK admite null); hoy la UI ya no ofrece volver a null
 *   —el dropdown de Apply reemplazó "— sin clasificar" por X—, pero el modelo lo
 *   sigue soportando.
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
    // Sin total_amount/currency: el modelo es en horas (se dropean en 0041).
    .select(
      'id, supplier_invoice_number, sp_invoice_number, project, client, week_start, invoice_date, notes, user_name, entry_ids, status, payment_terms_days, created_at, created_by',
    )
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return data.map(rowToInvoice)
}

/**
 * Filas `invoice_contractors` de TODAS las facturas (o de un set de ids). El módulo
 * Payments las usa para expandir cada factura `Invoiced` a sus contractors y decidir
 * a quién le falta pagar (payableInvoicesByContractor). Devuelve el shape camelCase de
 * la UI (rowToInvoiceContractor). En modo demo no hay tabla hija → [].
 * @param {Array<string|number>=} invoiceIds  opcional, para acotar a ciertas facturas
 * @returns {Promise<object[]>}
 */
const INVOICE_CONTRACTOR_COLUMNS =
  'id, invoice_id, contractor, entry_ids, hours, supplier_invoice_number, payment_date, payment_id'

export async function getInvoiceContractors(invoiceIds) {
  if (!isSupabaseConfigured) {
    await new Promise((resolve) => setTimeout(resolve, 120))
    if (Array.isArray(invoiceIds)) {
      const wanted = new Set(invoiceIds.map(String))
      return demoInvoiceContractors
        .filter((c) => wanted.has(String(c.invoiceId)))
        .map((c) => ({ ...c, entryIds: [...c.entryIds] }))
    }
    return demoInvoiceContractors.map((c) => ({ ...c, entryIds: [...c.entryIds] }))
  }
  // Si se pasan ids, se acota con `.in()` en tandas (misma razón que getFrozenEntryIds:
  // una URI con cientos de ids da 414). Sin ids, trae todas (la tabla es chica).
  if (Array.isArray(invoiceIds)) {
    const numericIds = invoiceIds.map(Number).filter((n) => Number.isFinite(n))
    if (numericIds.length === 0) return []
    const out = []
    for (const chunk of chunkIds(numericIds)) {
      const { data, error } = await supabase
        .from('invoice_contractors')
        .select(INVOICE_CONTRACTOR_COLUMNS)
        .in('invoice_id', chunk)
        .order('id', { ascending: true })
      if (error) throw new Error(error.message)
      for (const row of data) out.push(rowToInvoiceContractor(row))
    }
    return out
  }
  const { data, error } = await supabase
    .from('invoice_contractors')
    .select(INVOICE_CONTRACTOR_COLUMNS)
    .order('id', { ascending: true })
  if (error) throw new Error(error.message)
  return data.map(rowToInvoiceContractor)
}

/**
 * Demo (sin Supabase): marca una fila invoice_contractors como pagada, para que el
 * supplier invoice number + fecha + link al pago PERSISTAN entre recargas de Payments
 * (getInvoiceContractors relee el store). En prod lo hace la RPC en la base; acá es el
 * equivalente in-memory. La llama paymentsData.createPayment en su rama demo.
 */
export function markDemoInvoiceContractorPaid(invoiceContractorId, { paymentId, supplierInvoiceNumber, paymentDate }) {
  demoInvoiceContractors = demoInvoiceContractors.map((c) =>
    c.id === invoiceContractorId
      ? {
          ...c,
          paymentId: paymentId ?? c.paymentId,
          supplierInvoiceNumber: supplierInvoiceNumber ?? c.supplierInvoiceNumber,
          paymentDate: paymentDate ?? c.paymentDate,
        }
      : c,
  )
}

/**
 * Emite una factura single-contractor desde la vista legacy de Time Entries.
 *
 * Modelo en HORAS (slice 04d): se unifica al camino AGRUPADO — una factura de un solo
 * contractor es el caso degenerado de la factura multi-contractor. Se emite vía la RPC
 * `create_grouped_invoice` (0039) con UNA fila `invoice_contractors` (el contractor =
 * userName, entry_ids = las horas seleccionadas). Así la factura ES pagable en Payments
 * (que expande cada factura a sus invoice_contractors) y no arrastra monto/moneda.
 * El número cargado se guarda como SP invoice number (SouthPoint → cliente); el supplier#
 * del contractor se carga al pagar. Las horas las DERIVA la RPC de time_entries.
 *
 * OPEN ITEM: en /time-entries la selección puede cruzar proyectos/semanas (la vista no lo
 * restringe como /billing). Acá se toma el proyecto/cliente de la primera entry; para
 * emisión agrupada estricta por proyecto+semana usar /billing (GroupedBillModal).
 *
 * @param {{
 *   supplierInvoiceNumber: string,   // se guarda como SP invoice number
 *   notes?: string,
 *   userName: string,
 *   project?: string,
 *   client?: string,
 *   entryIds: Array<string|number>,
 *   createdBy?: string,
 * }} payload
 * @returns {Promise<{ ok: true, mode: 'supabase'|'demo', invoice: Invoice }>}
 */
export async function createInvoice({
  supplierInvoiceNumber,
  notes,
  userName,
  project = null,
  client = null,
  entryIds,
  createdBy,
}) {
  // entry_ids en Supabase es bigint[]; filtramos cualquier id no-numérico.
  const numericIds = entryIds
    .map((id) => (typeof id === 'number' ? id : Number(id)))
    .filter((id) => Number.isFinite(id))

  if (!isSupabaseConfigured) {
    await new Promise((resolve) => setTimeout(resolve, 350))
    // Sufijo aleatorio además del timestamp: dos emisiones en el mismo ms no colisionan
    // de id (claves de React / atribución en el store demo de invoice_contractors).
    const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const id = `inv-demo-${uniq}`
    const invoiceRow = {
      id,
      supplier_invoice_number: null,
      sp_invoice_number: supplierInvoiceNumber,
      project,
      client,
      week_start: null,
      invoice_date: null,
      notes: notes || null,
      user_name: userName,
      entry_ids: [...numericIds],
      status: 'Invoiced',
      payment_terms_days: 30,
      created_at: new Date().toISOString(),
      created_by: createdBy || null,
    }
    // Fila invoice_contractors demo (single-contractor) → la factura es pagable en
    // Payments sin Supabase. hours se estima desde MOCK_TIME_ENTRIES cuando existan.
    demoInvoiceContractors = [
      ...demoInvoiceContractors,
      {
        id: `invc-demo-${uniq}`,
        invoiceId: id,
        contractor: userName,
        entryIds: [...numericIds],
        hours: numericIds.reduce((s, eid) => s + (mockEntryHours.get(eid) || 0), 0),
        supplierInvoiceNumber: null,
        paymentDate: null,
        paymentId: null,
      },
    ]
    return { ok: true, mode: 'demo', invoice: rowToInvoice(invoiceRow) }
  }

  // Emisión ATÓMICA agrupada con UN contractor (misma RPC que createGroupedInvoice). La
  // RPC valida la unicidad del SP number, deriva las horas y crea la fila hija.
  const { data, error } = await supabase.rpc('create_grouped_invoice', {
    p_sp_invoice_number: supplierInvoiceNumber,
    p_project: project,
    p_client: client,
    p_week_start: null,
    p_notes: notes || null,
    p_created_by: createdBy || null,
    p_contractors: [{ contractor: userName, entry_ids: numericIds }],
  })
  if (error) {
    if (error.code === '23505' || /already exists/i.test(error.message ?? '')) {
      const err = new Error('That invoice number already exists. Please use a different one.')
      err.code = 'duplicate'
      throw err
    }
    if (error.code === 'OV001') {
      const err = new Error(
        'One or more of these hours are already covered by another invoice or payment. Refresh and try again.',
      )
      err.code = 'overlap'
      throw err
    }
    throw new Error(error.message)
  }
  return { ok: true, mode: 'supabase', invoice: rowToInvoice(data.invoice) }
}

/**
 * Emite una factura AGRUPADA multi-contractor (modelo migración 0039): una sola
 * factura cubre UN cliente + UN proyecto + UNA semana y agrupa a varios
 * contractors. Inserta la fila `invoices` (SP invoice number + unidad facturable
 * + status `Invoiced`, sin plata) y N filas hijas `invoice_contractors`
 * (contractor + entry_ids + horas). Medida en HORAS: no toca monto/moneda.
 *
 * La construcción y validación del payload viven en el módulo puro
 * `invoiceContractors.js` (testeable con node --test); acá va sólo el I/O.
 *
 * @param {{
 *   spInvoiceNumber: string,
 *   project: string,
 *   client?: string,
 *   weekStart?: string,
 *   notes?: string,
 *   contractors: Array<{ contractor: string, entries: Array<{ id: string|number, hours: number }> }>,
 *   createdBy?: string,
 * }} selection
 * @returns {Promise<{ ok: true, mode: 'supabase'|'demo', invoice: object, contractors: object[] }>}
 */
export async function createGroupedInvoice({ createdBy, ...selection }) {
  const { invoice, contractorRows } = buildGroupedInvoicePayload(selection)

  if (!isSupabaseConfigured) {
    await new Promise((resolve) => setTimeout(resolve, 350))
    // Sufijo aleatorio + timestamp: dos emisiones en el mismo ms no colisionan de id.
    const id = `inv-demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    // Se arma una fila sintética (snake_case) y se pasa por rowToInvoice —la misma
    // normalización que la rama Supabase— para que demo y prod no puedan diverger
    // en el shape aunque rowToInvoice cambie. La factura agrupada es "sin plata".
    const invoiceRow = {
      id,
      supplier_invoice_number: null,
      sp_invoice_number: invoice.sp_invoice_number,
      project: invoice.project,
      client: invoice.client,
      week_start: invoice.week_start,
      invoice_date: null,
      total_amount: null,
      currency: 'USD',
      notes: invoice.notes,
      user_name: null,
      entry_ids: [...invoice.entry_ids],
      status: 'Invoiced',
      payment_terms_days: 30,
      created_at: new Date().toISOString(),
      created_by: createdBy || null,
    }
    const contractors = contractorRows.map((r, i) => ({
      // Basado en el id (ya único) de la factura → sin colisión entre emisiones.
      id: `${id}-c${i}`,
      invoiceId: id,
      contractor: r.contractor,
      entryIds: [...r.entry_ids],
      hours: r.hours,
      supplierInvoiceNumber: null,
      paymentDate: null,
      paymentId: null,
    }))
    // Persistir en el store demo para que Payments las liste como pagables.
    demoInvoiceContractors = [...demoInvoiceContractors, ...contractors]
    return { ok: true, mode: 'demo', invoice: rowToInvoice(invoiceRow), contractors }
  }

  // Emisión ATÓMICA en el servidor (create_grouped_invoice, migración 0039):
  // valida el SP invoice number (dedup en app: no hay constraint único por los
  // duplicados históricos del supplier#), inserta la factura y las N filas
  // `invoice_contractors` en una sola transacción. Un insert client-side en dos
  // pasos no sirve: la policy de DELETE de invoices sólo permite borrar facturas
  // de test, así que un rollback client-side de una factura real sería no-op y
  // dejaría una factura huérfana.
  // entry_ids de la factura los DERIVA el RPC de contractorRows (una sola fuente
  // de verdad); no se manda invoice.entry_ids aparte para que no puedan diverger.
  const { data, error } = await supabase.rpc('create_grouped_invoice', {
    p_sp_invoice_number: invoice.sp_invoice_number,
    p_project: invoice.project,
    p_client: invoice.client,
    p_week_start: invoice.week_start,
    p_notes: invoice.notes,
    p_created_by: createdBy || null,
    p_contractors: contractorRows,
  })
  if (error) {
    if (error.code === '23505' || /already exists/i.test(error.message ?? '')) {
      const err = new Error('That SP invoice number already exists. Please use a different one.')
      err.code = 'duplicate'
      throw err
    }
    // El guard anti-doble-factura del RPC (y el trigger 0037) rechazan con el
    // SQLSTATE propio OV001 si alguna hora ya está cubierta por otra factura o un
    // pago. Se matchea por ese código, no por el texto del mensaje.
    if (error.code === 'OV001') {
      const err = new Error(
        'One or more of these hours are already covered by another invoice or payment. Refresh and try again.',
      )
      err.code = 'overlap'
      throw err
    }
    throw new Error(error.message)
  }

  return {
    ok: true,
    mode: 'supabase',
    invoice: rowToInvoice(data.invoice),
    contractors: (data.contractors ?? []).map(rowToInvoiceContractor),
  }
}

// Normaliza una fila de `invoice_contractors` al shape de la UI.
function rowToInvoiceContractor(row) {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    contractor: row.contractor,
    entryIds: Array.isArray(row.entry_ids) ? row.entry_ids : [],
    hours: row.hours != null ? Number(row.hours) : 0,
    supplierInvoiceNumber: row.supplier_invoice_number ?? null,
    paymentDate: row.payment_date ?? null,
    paymentId: row.payment_id ?? null,
  }
}

/**
 * Ciclo de vida del Billing Status. "Pending" es la ausencia de factura; la
 * columna invoices.status sólo toma estos 3 valores. Transiciones permitidas:
 * Invoiced → Collected → Paid (sin saltos, sin retroceso).
 */
export const BILLING_STATUSES = ['Pending', 'Invoiced', 'Collected', 'Paid']

const VALID_TRANSITIONS = {
  // Invoiced puede ir a Collected (cobro) o directo a Paid: en el flujo actual
  // Collections no se usa y una factura emitida se paga directo (ver migración
  // 0036 / createPayment). nextStatus sigue devolviendo el primero (Collected).
  Invoiced: ['Collected', 'Paid'],
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
