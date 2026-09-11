import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, BellRing, ChevronDown, ChevronRight, Download } from 'lucide-react'
import { paymentAlertLevel } from '../lib/paymentsData'
import { useSyncReloadKey } from '../lib/useSyncReload'
import {
  pendingToPayByContractor,
  invoicelessPaidRows,
  paidEntryIdsFrom,
  summarizeEntries,
} from '../lib/paymentsGrouping'
import { invoiceCompletion } from '../lib/invoiceCompletion'
import { entryPaymentStatus } from '../lib/entryPaymentStatus'
import { buildProjectIndex, deriveEntriesClient } from '../lib/entryClient'
import {
  useEntryFilters,
  applyEntryFilters,
  buildFilterOptions,
} from '../lib/useEntryFilters'
import { EntryFilterBar } from '../components/EntryFilterBar'
import { api } from '../lib/api'
import { downloadPaymentReceipt } from '../lib/paymentReceipt'
import {
  formatDate,
  formatHours,
  formatWeek,
  sundayWeekYear,
  formatInvoicePeriod,
  distinctWeekCount,
} from '../lib/format'
import { BillingBadge } from '../components/BillingBadge'
import { RegisterPaymentModal } from '../components/RegisterPaymentModal'
import { Toast } from '../components/Toast'
import { ExportDropdown } from '../components/ExportDropdown'
import { exportGrid } from '../lib/exportGrid'

function addDaysISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) + days * 86400000).toISOString().slice(0, 10)
}
function daysUntil(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const target = Date.UTC(y, m - 1, d)
  const now = new Date()
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.round((target - today) / 86400000)
}

// Fecha de emisión de la factura para calcular el vencimiento del pago. Las facturas
// AGRUPADAS no cargan invoice_date (el modelo es en horas): se usa la fecha de creación.
// OPEN ITEM: confirmar con negocio la semántica de "payment due" de la factura agrupada
// (¿desde created_at, desde week_start?). Hoy: invoice_date si existe, si no created_at.
function issueDateOf(inv) {
  if (inv.invoiceDate) return inv.invoiceDate
  if (inv.createdAt) return String(inv.createdAt).slice(0, 10)
  return null
}

// Estados de factura PAGABLES al contractor. Flujo Billing → Payments (sin Collections):
// una factura emitida (Invoiced) se paga contractor por contractor; cuando TODOS están
// pagados pasa a Paid. Ver payableInvoicesByContractor / register_contractor_payment.
const isPayable = (status) => status === 'Invoiced'

// Allocations que se pagan al contractor SIN factura al cliente (invoice-less):
// overage y sp_internal. Mismo mecanismo de pago; sólo cambia la etiqueta.
const PAY_LABELS = {
  overage: { low: 'overage', cap: 'Overage' },
  sp_internal: { low: 'SP internal', cap: 'SP internal' },
}

// Map vacío compartido para applyEntryFilters/buildFilterOptions: sólo lo usan para
// resolver el filtro Billing Status (que en Payments no se usa — el "Estado" de acá es
// el de pago de la factura, aparte). Estable para no invalidar memos.
const NO_INVOICE_MAP = new Map()

// Opciones de la dimensión "Estado" en Payments = estado de PAGO de la factura.
const PAYMENT_STATUS_OPTIONS = ['Invoiced', 'Paid']

// Tope de horas YA pagadas que el picker "Hours to pay" muestra como contexto
// (las más recientes). Evita que el historial pagado —sin límite— sepulte las
// pendientes seleccionables.
const PAID_PICKER_LIMIT = 25

// Rango de semanas (domingo–sábado) que cubre un pago: "W33" si es una sola,
// "W33–W35" si cruza varias. null si no hay fechas. Usa el rango de fechas del
// resumen (summarizeEntries), no la lista completa.
function formatWeekRange(dateStart, dateEnd) {
  // Coalesce: si sólo llega una punta del rango, la otra la iguala (una sola semana)
  // en vez de formatear null como "—" y devolver un rango malformado tipo "W33–—".
  const from = dateStart ?? dateEnd
  const to = dateEnd ?? dateStart
  if (!from || !to) return null
  const start = formatWeek(from)
  const end = formatWeek(to)
  // El año se compara por el AÑO DE LA SEMANA domingo–sábado (sundayWeekYear), no por
  // el año calendario del string: una semana física que cruza el 31-dic pertenece al
  // año de su domingo. Así dos fechas de la MISMA semana no se muestran como si
  // cruzaran de año, y una que sí cambia de año-semana se desambigua con el año (y no
  // se invierte el rango por comparar años calendario iguales de semanas distintas).
  const yearStart = sundayWeekYear(from)
  const yearEnd = sundayWeekYear(to)
  if (yearStart !== yearEnd) return `${start} ${yearStart}–${end} ${yearEnd}`
  return start === end ? start : `${start}–${end}`
}

// Id ÚNICO y estable para la fila de detalle, derivado de su clave de expand. Se
// codifica la clave a hex (4 dígitos por unidad UTF-16) en vez de "sanear"
// reemplazando caracteres inválidos: el reemplazo no es inyectivo (dos claves
// distintas —p. ej. "Ana B" y "Ana-B", o una con ":"— colapsarían al mismo id,
// duplicando ids y rompiendo el aria-controls). El hex sí lo es y da chars válidos.
function detailIdFor(key) {
  const str = String(key)
  let hex = ''
  for (let i = 0; i < str.length; i++) hex += str.charCodeAt(i).toString(16).padStart(4, '0')
  return `pay-detail-${hex}`
}

// Meta condensada de una fila a partir del resumen agregado: proyecto (o "N
// projects" si cruza varios), cliente (o "N clients"), y el rango de semanas. Une
// sólo las partes con dato, con " · ". Devuelve '' si no hay nada que mostrar.
function formatGroupMeta(summary) {
  const parts = []
  if (summary.projects.length === 1) parts.push(summary.projects[0])
  else if (summary.projects.length > 1) parts.push(`${summary.projects.length} projects`)
  if (summary.clients.length === 1) parts.push(summary.clients[0])
  else if (summary.clients.length > 1) parts.push(`${summary.clients.length} clients`)
  const weeks = formatWeekRange(summary.dateStart, summary.dateEnd)
  if (weeks) parts.push(weeks)
  return parts.join(' · ')
}

// Desglose por hora de un pago (contractor de factura o invoice-less): una tabla
// chica con Project #, Project, Client, Task, Date y Hours por cada time entry
// cubierta. Se reusa en las tres tablas (pendientes, pagadas, invoice-less). Las
// horas vienen ya enriquecidas (client/projectNumber) por deriveEntriesClient.
function EntryBreakdown({ entries }) {
  if (!entries || entries.length === 0) {
    return <div className="pay-breakdown__empty">No hour detail available for this payment.</div>
  }
  const sorted = [...entries].sort((a, b) =>
    String(a.date || '').localeCompare(String(b.date || '')),
  )
  return (
    <table className="pay-breakdown">
      <thead>
        <tr>
          <th scope="col">Project #</th>
          <th scope="col">Project</th>
          <th scope="col">Client</th>
          <th scope="col">Task</th>
          <th scope="col">Date</th>
          <th scope="col" className="col-num">Hours</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((entry) => (
          <tr key={entry.id}>
            <td className="cell-mono">{entry.projectNumber || '—'}</td>
            <td>{entry.project || '—'}</td>
            <td>{entry.client || '—'}</td>
            <td>{entry.task || '—'}</td>
            <td className="cell-mono">{entry.date ? formatDate(entry.date) : '—'}</td>
            <td className="col-num cell-mono">{formatHours(entry.hours)} h</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// Celda líder de una fila de pago: el botón chevron para expandir/colapsar el
// detalle, el nombre (contractor) y, debajo, un meta condensado opcional
// (proyecto/cliente/semana). Se reusa en las tres tablas (pendientes de factura,
// invoice-less pendientes e invoice-less pagadas) para no duplicar el afford ni la
// redacción de accesibilidad.
function PayExpandCell({ open, onToggle, name, meta, controls }) {
  return (
    <div className="pay-cell-lead">
      <button
        type="button"
        className="pay-expand"
        onClick={onToggle}
        aria-expanded={open}
        // Sólo se referencia el detalle cuando existe en el DOM (fila expandida):
        // la fila de detalle no se renderiza mientras está colapsada, así que un
        // aria-controls fijo apuntaría a un id inexistente.
        aria-controls={open ? controls : undefined}
        aria-label={open ? 'Hide hour detail' : 'Show hour detail'}
      >
        {open ? (
          <ChevronDown size={15} aria-hidden="true" />
        ) : (
          <ChevronRight size={15} aria-hidden="true" />
        )}
      </button>
      <span className="pay-cell-lead__text">
        <span>{name}</span>
        {meta && <span className="cell-soft pay-meta">{meta}</span>}
      </span>
    </div>
  )
}

export function PaymentsPage() {
  const { user, profile, can } = useOutletContext()
  const [invoices, setInvoices] = useState([])
  const [invoiceContractors, setInvoiceContractors] = useState([])
  const [payments, setPayments] = useState([])
  const [alertSettings, setAlertSettings] = useState(null)
  const [status, setStatus] = useState('loading')
  const [showPaid, setShowPaid] = useState(false)
  const [alertFilter, setAlertFilter] = useState(null) // null|'overdue'|'dueThisWeek'
  // Contractor de una factura agrupada que se está por pagar: { invoice, ic } (ic = fila
  // invoice_contractors). null = modal cerrado.
  const [payTargetContractor, setPayTargetContractor] = useState(null)
  // Contractor cuyo pago invoice-less (overage o sp_internal) se está por registrar.
  const [payTarget, setPayTarget] = useState(null)
  const [paySelectedIds, setPaySelectedIds] = useState(() => new Set())
  const [entries, setEntries] = useState([])
  // Proyectos: sólo para mapear el NOMBRE de proyecto de la factura a su número
  // (columna "Project #" del encabezado). La factura guarda el proyecto como texto,
  // así que el número se une por nombre — con el caveat de nombres homónimos (abajo).
  const [projects, setProjects] = useState([])
  // Clientes: para resolver el cliente de cada hora (time_entries.client llega
  // vacío del sync; el dato vive en el proyecto → grupo → cliente). Va aparte del
  // core igual que projects: si falla, la fila muestra proyecto sin cliente.
  const [clients, setClients] = useState([])
  // Filas expandidas (detalle por hora). Clave: `inv:<icId>` para contractors de
  // factura, `<allocation>:<user>` para pendientes invoice-less, `paid:<paymentId>`
  // para pagos invoice-less ya hechos.
  const [expandedKeys, setExpandedKeys] = useState(() => new Set())
  const [toast, setToast] = useState(null)

  function load() {
    setStatus('loading')
    // Al recargar (montaje o tras una carrera de pago) se colapsan las filas: las
    // claves de expand se derivan de los datos actuales, y conservar claves viejas
    // podría auto-expandir una fila que reaparece con el mismo contractor.
    setExpandedKeys(new Set())
    Promise.all([
      api.invoices.list(),
      api.invoices.listContractors(),
      api.payments.list(),
      api.payments.getAlertSettings(),
      api.timeEntries.list(),
    ])
      .then(([inv, ic, pay, settings, entryRows]) => {
        setInvoices(inv)
        setInvoiceContractors(ic)
        setPayments(pay)
        setAlertSettings(settings)
        setEntries(entryRows)
        setStatus('ready')
      })
      .catch((error) => {
        console.error('No se pudo cargar Payments:', error)
        setStatus('error')
      })
    // Los proyectos son SÓLO para el número de proyecto (cosmético) del header de
    // la factura. Van aparte del Promise.all core: si este fetch falla, el header
    // muestra sólo el nombre y la página —con sus datos de pago— igual carga. Meterlo
    // en el core haría que un fallo acá tumbara todo Payments por una columna.
    api.projects
      .list()
      .then((projectRows) => setProjects(projectRows))
      .catch((error) =>
        console.warn('No se pudieron cargar los proyectos (número de proyecto en el header):', error),
      )
    // Clientes: sólo para resolver el cliente de cada hora en el detalle/meta. Igual
    // que projects, va aparte del core: si falla, se muestra el proyecto sin cliente
    // en vez de tumbar toda la página por una columna informativa.
    api.clients
      .list()
      .then((clientRows) => setClients(clientRows))
      .catch((error) =>
        console.warn('No se pudieron cargar los clientes (cliente en el detalle de horas):', error),
      )
  }

  const reloadKey = useSyncReloadKey()
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey])

  // invoice_contractors agrupados por factura (para expandir cada factura a sus
  // contractors pendientes de pago).
  const contractorsByInvoice = useMemo(() => {
    const map = new Map()
    for (const ic of invoiceContractors) {
      const arr = map.get(ic.invoiceId) ?? []
      arr.push(ic)
      map.set(ic.invoiceId, arr)
    }
    return map
  }, [invoiceContractors])

  // Número de proyecto de la factura desde su nombre (la factura sólo guarda el
  // nombre; el número vive en el proyecto). Se reusa buildProjectIndex —el mismo
  // índice que usan Entries/Billing vía deriveEntriesClient— para no duplicar la
  // lógica ni divergir en la semántica de ambigüedad: nombre homónimo → null (se
  // muestra sólo el nombre) en vez de un número que sería engañoso.
  const projectIndex = useMemo(() => buildProjectIndex(projects), [projects])
  const projectNumberFor = (name) =>
    name ? projectIndex.byName.get(name)?.projectNumber ?? null : null

  // Horas enriquecidas con client + projectNumber (deriveEntriesClient: resuelve la
  // cadena hora → proyecto → grupo → cliente por id de Zoho). Alimenta el desglose
  // por hora y el meta de cada fila. Recalcula cuando llegan projects/clients (que
  // cargan aparte del core): mientras no estén, muestra proyecto sin cliente.
  const enrichedEntries = useMemo(
    () => deriveEntriesClient(entries, projects, clients),
    [entries, projects, clients],
  )
  // Índice hora-por-id para joinear los entry_ids de un contractor de factura (o de
  // un pago invoice-less ya hecho) con su desglose enriquecido.
  const entryById = useMemo(() => {
    const map = new Map()
    for (const entry of enrichedEntries) map.set(String(entry.id), entry)
    return map
  }, [enrichedEntries])
  const entriesForIds = (entryIds) =>
    (entryIds ?? []).map((id) => entryById.get(String(id))).filter(Boolean)

  // --- Barra de filtros (misma que Billing) --------------------------------------
  // Dimensiones de horas (cliente/proyecto/#/contractor) sobre enrichedEntries, más
  // "Estado" = estado de PAGO de la factura (Invoiced/Paid), que es propio de Payments
  // y no vive en useEntryFilters (por eso paymentStatuses aparte). Filtra facturas y
  // grupos overage/sp_internal por las horas que contienen.
  const { filters, toggleValue, clear, isActive } = useEntryFilters()
  const [paymentStatuses, setPaymentStatuses] = useState([])
  const masterNames = useMemo(
    () => new Set(clients.map((c) => c.clientName).filter(Boolean)),
    [clients],
  )
  const entryDimsActive =
    filters.clients.length > 0 ||
    filters.projects.length > 0 ||
    filters.projectNumbers.length > 0 ||
    filters.contractors.length > 0

  const paymentFilterActive = isActive || paymentStatuses.length > 0
  // Callbacks estables + filters memoizado: así el EntryFilterBar (React.memo) no se
  // re-renderiza en renders no relacionados de la página.
  const onFilterToggle = useCallback(
    (key, value) => {
      if (key === 'paymentStatuses') {
        setPaymentStatuses((prev) =>
          prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
        )
      } else {
        toggleValue(key, value)
      }
    },
    [toggleValue],
  )
  const onFilterClear = useCallback(() => {
    clear()
    setPaymentStatuses([])
  }, [clear])
  const combinedFilters = useMemo(
    () => ({ ...filters, paymentStatuses }),
    [filters, paymentStatuses],
  )
  // NOTA: las OPCIONES del filtro y el matching (matchingEntryIds/passesEntryFilter/
  // filterDimensions) se computan MÁS ABAJO, sobre el universo REALMENTE mostrado
  // (facturas pagables/Paid + grupos invoice-less), no sobre todas las horas — si no, un
  // dropdown ofrecería contractors/proyectos con horas aún no facturadas que vaciarían la
  // página al elegirlos. Ver `displayedEntries`.

  const isExpanded = (key) => expandedKeys.has(key)
  const toggleExpand = (key) =>
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  // Semanas realmente facturadas por una factura: las horas de todos sus contractors
  // → fechas → semanas distintas. 1 en una factura de una sola semana. Se usa para el
  // "(N weeks)" del período (grilla y receipt), así que vive en un solo lugar.
  //
  // Reusa el índice `entryById` (horas enriquecidas, que ya cargan `date`) en vez de un
  // segundo map paralelo. Devuelve null si ALGÚN entry_id no está en el `entries`
  // cargado O no tiene fecha resoluble: sin datos completos no afirmamos un conteo,
  // porque un sub-conteo haría que formatInvoicePeriod marque como "no contiguo" (y
  // agregue un "(N weeks)" erróneo) a una factura que en realidad sí lo es. Con null, el
  // período degrada al rango pelado (seguro). getTimeEntries no pagina (cap ~1000, misma
  // asunción que overage/sp_internal en esta página); si algún día se supera, se pagina.
  const invoiceWeekCount = (invoiceId) => {
    const ids = (contractorsByInvoice.get(invoiceId) ?? []).flatMap((c) => c.entryIds ?? [])
    const dates = []
    for (const id of ids) {
      const date = entryById.get(String(id))?.date
      if (!date) return null // hora ausente o sin fecha → sin conteo afirmable
      dates.push(date)
    }
    return distinctWeekCount(dates)
  }

  const warningBefore = alertSettings?.warningDaysBeforeDue ?? 3
  const ALERT_RANK = { overdue: 0, warning: 1, on_time: 2 }

  // Una fila por factura, expandida a sus contractors vía el módulo puro (y testeado)
  // `invoiceCompletion`: deriva paid/paidCount/totalCount/totalHours en horas (una fila
  // pagada por payment_id o por cobertura de entry_ids; una fila sin entry_ids se
  // descarta). Una factura Invoiced con todos sus contractors ya pagos (estado
  // transitorio antes de que la RPC flipee a Paid) no tiene pendientes → se oculta.
  const invoiceRows = useMemo(() => {
    const rows = []
    // Las Paid se incluyen si el toggle "Show paid" está on O si el filtro de Estado
    // pide 'Paid' (sin esto, filtrar Estado='Paid' daría la grilla vacía).
    const includePaid = showPaid || paymentStatuses.includes('Paid')
    for (const inv of invoices) {
      if (!(isPayable(inv.status) || (includePaid && inv.status === 'Paid'))) continue
      const completion = invoiceCompletion(contractorsByInvoice.get(inv.id) ?? [], payments)
      // Decora cada contractor una sola vez (acá, memoizado) con su desglose de horas
      // y el rango de semanas: así el render no rejoinea/reagrega en cada toggle/toast.
      const contractors = completion.contractors.map((ic) => {
        const contractorEntries = entriesForIds(ic.entryIds)
        const summary = summarizeEntries(contractorEntries)
        return {
          ...ic,
          entries: contractorEntries,
          weeks: formatWeekRange(summary.dateStart, summary.dateEnd),
        }
      })
      const pending = contractors.filter((c) => !c.paid)
      // Invoiced sin filas o sin pendientes = transitorio (todos pagos, RPC aún no
      // flipeó): ocultar (mismo criterio que payableInvoicesByContractor).
      if (isPayable(inv.status) && (completion.totalCount === 0 || pending.length === 0)) continue

      const issue = issueDateOf(inv)
      const dueDate =
        inv.status !== 'Paid' && issue ? addDaysISO(issue, inv.paymentTermsDays ?? 30) : null
      const daysUntilDue = dueDate ? daysUntil(dueDate) : null
      const alertLevel =
        inv.status === 'Paid' || !dueDate
          ? 'on_time'
          : paymentAlertLevel(daysUntilDue, warningBefore)
      rows.push({
        inv,
        contractors,
        pending,
        paidCount: completion.paidCount,
        totalCount: completion.totalCount,
        totalHours: completion.totalHours,
        // Período ya formateado (rango de semanas + "(N weeks)" si no contiguo). Cadena
        // vacía si weekStart es inválido → el render cae a nada (no un "· " colgado).
        period: formatInvoicePeriod(inv.weekStart, inv.weekEnd, invoiceWeekCount(inv.id)),
        dueDate,
        daysUntilDue,
        alertLevel,
      })
    }
    return rows
  }, [invoices, contractorsByInvoice, payments, showPaid, paymentStatuses, warningBefore, entryById])

  // Horas invoice-less pendientes de pago, por contractor (overage / sp_internal).
  // El meta condensado (proyecto/cliente/semana) de cada grupo se computa acá, una vez,
  // no en el render: así toggle/toast/modal no re-agregan cada fila.
  const withMeta = (group) => ({ ...group, meta: formatGroupMeta(summarizeEntries(group.entries)) })
  const overagePending = useMemo(
    () => pendingToPayByContractor(enrichedEntries, payments, invoices, 'overage').map(withMeta),
    [enrichedEntries, payments, invoices],
  )
  const spInternalPending = useMemo(
    () => pendingToPayByContractor(enrichedEntries, payments, invoices, 'sp_internal').map(withMeta),
    [enrichedEntries, payments, invoices],
  )

  // Pagos invoice-less YA hechos (read-only), separados por allocation. Se decoran con
  // su desglose de horas (join por entry_ids) y el meta, una vez, para no rejoinear en
  // cada render.
  const { overage: overagePaid, spInternal: spInternalPaid } = useMemo(() => {
    const { overage, spInternal } = invoicelessPaidRows(payments, enrichedEntries)
    const decorate = (row) => {
      const rowEntries = entriesForIds(row.entryIds)
      return { ...row, entries: rowEntries, meta: formatGroupMeta(summarizeEntries(rowEntries)) }
    }
    return { overage: overage.map(decorate), spInternal: spInternal.map(decorate) }
  }, [payments, enrichedEntries, entryById])

  // Universo de horas REALMENTE mostrado en Payments: las que respaldan una factura
  // pagable/Paid o un grupo invoice-less. Las opciones del filtro y el matching se
  // calculan sobre esto (no sobre TODAS las horas) para que un dropdown nunca ofrezca un
  // valor con horas aún no facturadas que vaciaría la página al elegirlo (finding review).
  const displayedEntries = useMemo(() => {
    const ids = new Set()
    for (const r of invoiceRows)
      for (const c of r.contractors) for (const id of c.entryIds ?? []) ids.add(String(id))
    // Los grupos invoice-less se OCULTAN con un filtro de Estado activo (son de factura):
    // en ese caso sus horas no deben ofrecer opciones que vaciarían la página.
    if (paymentStatuses.length === 0) {
      const addGroupIds = (list) => {
        for (const g of list) for (const id of g.entryIds ?? []) ids.add(String(id))
      }
      addGroupIds(overagePending)
      addGroupIds(spInternalPending)
      addGroupIds(overagePaid)
      addGroupIds(spInternalPaid)
    }
    return enrichedEntries.filter((e) => ids.has(String(e.id)))
  }, [
    invoiceRows,
    overagePending,
    spInternalPending,
    overagePaid,
    spInternalPaid,
    enrichedEntries,
    paymentStatuses,
  ])

  const filterOptions = useMemo(
    () => buildFilterOptions(displayedEntries, filters, NO_INVOICE_MAP, masterNames),
    [displayedEntries, filters, masterNames],
  )
  // Ids (string) de las horas MOSTRADAS que pasan el filtro de dimensiones. null = ninguna
  // dimensión de horas activa → no se filtra por horas.
  const matchingEntryIds = useMemo(() => {
    if (!entryDimsActive) return null
    return new Set(
      applyEntryFilters(displayedEntries, filters, NO_INVOICE_MAP, masterNames).map((e) =>
        String(e.id),
      ),
    )
  }, [entryDimsActive, displayedEntries, filters, masterNames])
  // Una factura/grupo pasa el filtro de horas si tiene al menos una hora mostrada que matchea.
  const passesEntryFilter = (entryIds) =>
    !matchingEntryIds || (entryIds ?? []).some((id) => matchingEntryIds.has(String(id)))
  const filterDimensions = useMemo(
    () => [
      // Todas las dimensiones (Client incluido) salen de displayedEntries → los dropdowns
      // sólo ofrecen valores que respaldan algo mostrado (no vacían la página).
      { key: 'clients', label: 'Client', options: filterOptions.clients },
      { key: 'projectNumbers', label: 'Project #', options: filterOptions.projectNumbers },
      { key: 'projects', label: 'Project', options: filterOptions.projects },
      { key: 'contractors', label: 'Contractor', options: filterOptions.contractors },
      { key: 'paymentStatuses', label: 'Status', options: PAYMENT_STATUS_OPTIONS },
    ],
    [filterOptions],
  )

  // Filtra las filas invoice-less (cada una con .entryIds/.entries/.hours) por el filtro
  // de HORAS y, con un filtro activo, las ACOTA a las horas que matchean: un grupo por
  // contractor puede cruzar clientes/proyectos, así que además de decidir si se ve, se le
  // recortan las horas/entradas/meta al cliente/proyecto filtrado (si no, mostraría el
  // total cruzado del contractor y el picker pre-pagaría horas de otro cliente).
  const filterByEntries = useCallback(
    (list) => {
      const kept = (list ?? []).filter((x) => passesEntryFilter(x.entryIds))
      if (!matchingEntryIds) return kept
      return kept.map((g) => {
        const entries = (g.entries ?? []).filter((e) => matchingEntryIds.has(String(e.id)))
        const entryIds = (g.entryIds ?? []).filter((id) => matchingEntryIds.has(String(id)))
        return {
          ...g,
          entries,
          entryIds,
          entryCount: entryIds.length, // recomputar: si no, las paid rows mostrarían el count viejo
          hours: entries.reduce((s, e) => s + (Number(e.hours) || 0), 0),
          meta: formatGroupMeta(summarizeEntries(entries)),
        }
      })
    },
    // passesEntryFilter/narrow sólo dependen de matchingEntryIds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [matchingEntryIds],
  )
  // Grupos/pagos invoice-less que pasan el filtro de HORAS (memoizados). El "Estado" de
  // pago no aplica a lo invoice-less; se filtran sólo por cliente/proyecto/#/contractor.
  // Se incluyen los PAGADOS (renderPaid) para que el filtro sea consistente en toda la
  // página, no sólo en las facturas y lo pendiente.
  const overagePendingF = useMemo(() => filterByEntries(overagePending), [filterByEntries, overagePending])
  const spInternalPendingF = useMemo(() => filterByEntries(spInternalPending), [filterByEntries, spInternalPending])
  const overagePaidF = useMemo(() => filterByEntries(overagePaid), [filterByEntries, overagePaid])
  const spInternalPaidF = useMemo(() => filterByEntries(spInternalPaid), [filterByEntries, spInternalPaid])

  // Ids (string) de las horas YA pagadas: lo usa el picker "Hours to pay" para
  // marcar el estado de cada hora (entryPaymentStatus). Las pendientes que muestra
  // el picker dan 'pending'; una ya pagada daría 'paid' (defensivo).
  const paidEntryIds = useMemo(() => paidEntryIdsFrom(payments), [payments])

  // Una hora es pendiente (seleccionable/pagable) si no está en las pagadas. El picker
  // muestra ambas; sólo las pendientes entran a la selección y al pago. Se usa igual en
  // el display y en el submit para que no puedan divergir.
  const isPending = (entry) => entryPaymentStatus(entry, paidEntryIds) === 'pending'

  // Facturas que pasan la BARRA de filtros (horas: cliente/proyecto/#/contractor, +
  // Estado de pago), SIN el filtro de alertas (que lo manejan los chips). Es la base
  // común de los KPIs y de la grilla, para que el header y las filas no diverjan.
  // LIMITACIÓN conocida: el filtro de horas mira el cliente/proyecto DERIVADO de las
  // horas (matchingEntryIds), no el inv.client/inv.project crudo de la factura. Si las
  // horas de una factura no resuelven al mismo cliente que muestra su header (nombre
  // legacy, cadena sin resolver, o horas más allá del cap de sync), esa factura puede no
  // matchear un filtro por ese cliente. Es el mismo criterio de resolución que Billing.
  // Además, un filtro de Estado explícito manda sobre "Show paid" (si filtrás Invoiced,
  // no ves Paid aunque el toggle esté on) — es intencional, el filtro es más específico.
  const filteredInvoiceRows = useMemo(
    () =>
      invoiceRows.filter((r) => {
        if (paymentStatuses.length > 0 && !paymentStatuses.includes(r.inv.status)) return false
        const entryIds = r.contractors.flatMap((c) => c.entryIds ?? [])
        return passesEntryFilter(entryIds)
      }),
    [invoiceRows, paymentStatuses, matchingEntryIds],
  )

  // KPIs sobre las facturas FILTRADAS pendientes de pago. Total pendiente en HORAS (suma
  // de las horas de los contractors todavía sin pagar en las facturas pagables).
  const kpis = useMemo(() => {
    let overdue = 0
    let dueThisWeek = 0
    let pendingHours = 0
    // Las facturas son unidades atómicas multi-contractor: la grilla muestra la factura
    // ENTERA (todos sus contractors) cuando pasa el filtro, así que el KPI cuenta igual —
    // todas las horas pendientes de las facturas mostradas — para que header y grilla no
    // divergan. "Filtrar por contractor" = ver las facturas que lo incluyen (enteras).
    for (const r of filteredInvoiceRows) {
      if (!isPayable(r.inv.status)) continue
      pendingHours += r.contractors.reduce((s, ic) => s + (ic.paid ? 0 : Number(ic.hours) || 0), 0)
      if (r.dueDate) {
        if (r.alertLevel === 'overdue') overdue += 1
        if (r.daysUntilDue >= 0 && r.daysUntilDue <= 7) dueThisWeek += 1
      }
    }
    return { overdue, dueThisWeek, pendingHours }
  }, [filteredInvoiceRows])

  const rows = useMemo(() => {
    const filtered = filteredInvoiceRows.filter((r) => {
      if (alertFilter === 'overdue') return r.alertLevel === 'overdue'
      if (alertFilter === 'dueThisWeek')
        return Boolean(r.dueDate) && r.daysUntilDue >= 0 && r.daysUntilDue <= 7
      return true
    })
    // Pagables primero (Invoiced antes que Paid); dentro, vencidos arriba y luego por
    // fecha de vencimiento. Las Paid (sin deadline) caen al final.
    return filtered.sort(
      (a, b) =>
        Number(a.inv.status === 'Paid') - Number(b.inv.status === 'Paid') ||
        ALERT_RANK[a.alertLevel] - ALERT_RANK[b.alertLevel] ||
        (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31'),
    )
  }, [filteredInvoiceRows, alertFilter])

  // Pago de UN contractor de una factura agrupada. Al completar el último, la factura
  // pasa a Paid. Maneja carreras (already_paid / not_payable / stale) recargando.
  async function handlePayContractor(payload) {
    const { invoice: inv, ic } = payTargetContractor
    try {
      const { payment } = await api.payments.create(ic, payload, user?.email ?? null)
      // Marca la fila del contractor como pagada localmente (payment_id + supplier#).
      const nextContractors = (contractorsByInvoice.get(inv.id) ?? []).map((row) =>
        row.id === ic.id
          ? {
              ...row,
              paymentId: payment.id,
              supplierInvoiceNumber: payload.supplierInvoiceNumber ?? row.supplierInvoiceNumber,
              paymentDate: payload.paymentDate,
            }
          : row,
      )
      setInvoiceContractors((prev) =>
        prev.map((row) => {
          const hit = nextContractors.find((n) => n.id === row.id)
          return hit ?? row
        }),
      )
      setPayments((prev) => [payment, ...prev])
      // Si con este pago quedaron todas las filas pagas, la RPC ya flipeó la factura a
      // Paid: reflejarlo en el estado local.
      const nextPaidIds = paidEntryIdsFrom([payment, ...payments])
      const allPaid = nextContractors
        .filter((row) => (row.entryIds?.length ?? 0) > 0)
        .every(
          (row) =>
            row.paymentId != null ||
            (row.entryIds ?? []).every((id) => nextPaidIds.has(String(id))),
        )
      if (allPaid) {
        setInvoices((prev) =>
          prev.map((i) => (i.id === inv.id ? { ...i, status: 'Paid' } : i)),
        )
      }
      api.audit.log({
        actorEmail: user?.email,
        actorRole: profile?.roles?.[0] ?? null,
        action: 'payment.create',
        resourceType: 'payment',
        resourceId: payment.id,
        after: {
          invoiceId: inv.id,
          spInvoiceNumber: inv.spInvoiceNumber,
          contractor: ic.contractor,
          supplierInvoiceNumber: payload.supplierInvoiceNumber,
          hours: ic.hours,
          paymentDate: payload.paymentDate,
        },
      })
      setPayTargetContractor(null)
      setToast({
        id: Date.now(),
        message: `${ic.contractor} paid — ${formatHours(ic.hours)} h${
          allPaid ? ` · ${inv.spInvoiceNumber ?? 'invoice'} → Paid` : ''
        }`,
      })
    } catch (error) {
      // Carrera / estado obsoleto: cerrar, avisar y recargar para ver el estado real.
      setPayTargetContractor(null)
      setToast({ id: Date.now(), tone: 'error', message: error?.message ?? 'Could not register the payment.' })
      load()
    }
  }

  // Pago invoice-less (overage o sp_internal): cubre las horas SELECCIONADAS del
  // contractor. Sin factura y sin monto (en horas).
  async function handleRegisterPayment(payload) {
    const { allocation, user: contractor } = payTarget
    // Sólo horas pendientes: payTarget.entries ahora incluye las ya pagadas (read-only
    // en el picker); el guard isPending evita re-pagar una hora aunque su id llegara a
    // paySelectedIds por un cambio futuro. Mismo criterio que el display.
    const selected = payTarget.entries.filter(
      (e) => paySelectedIds.has(String(e.id)) && isPending(e),
    )
    const entryIds = selected.map((e) => e.id)
    const hours = selected.reduce((sum, e) => sum + e.hours, 0)
    const { payment } = await api.payments.createOverage(
      { userName: contractor, entryIds, ...payload },
      user?.email ?? null,
    )
    api.audit.log({
      actorEmail: user?.email,
      actorRole: profile?.roles?.[0] ?? null,
      action: 'payment.create',
      resourceType: 'payment',
      resourceId: payment.id,
      after: {
        invoiceless: true,
        allocation,
        userName: contractor,
        entryCount: entryIds.length,
        hours,
        paymentDate: payload.paymentDate,
      },
    })
    setPayments((prev) => [payment, ...prev])
    setPayTarget(null)
    setToast({
      id: Date.now(),
      message: `${PAY_LABELS[allocation].cap} paid to ${contractor} — ${formatHours(hours)} h (frozen)`,
    })
  }

  function handleDownload(inv, ic) {
    const payment =
      payments.find((p) => p.id === ic.paymentId) ??
      payments.find(
        (p) => p.invoiceId === inv.id && p.userName === ic.contractor,
      )
    if (!payment) {
      setToast({ id: Date.now(), tone: 'error', message: 'Payment record not found for this contractor.' })
      return
    }
    downloadPaymentReceipt({
      invoice: inv,
      invoiceContractor: ic,
      payment,
      weekCount: invoiceWeekCount(inv.id),
      generatedBy: user?.email ?? null,
    })
  }

  function handleExport(format) {
    const cols = [
      { header: 'SP Invoice #', key: 'spInvoice' },
      { header: 'Project #', key: 'projectNumber' },
      { header: 'Project', key: 'project' },
      { header: 'Client', key: 'client' },
      { header: 'Contractor', key: 'contractor' },
      { header: 'Supplier Invoice #', key: 'supplierInvoice' },
      { header: 'Hours', key: 'hours' },
      { header: 'Contractor Status', key: 'contractorStatus' },
      { header: 'Invoice Status', key: 'invoiceStatus' },
      { header: 'Payment Due', key: 'dueDate' },
      { header: 'Payment Date', key: 'paymentDate' },
    ]
    // Una fila por contractor de cada factura (grano del pago).
    const exportRows = rows.flatMap((r) => {
      const projNum = projectNumberFor(r.inv.project) ?? ''
      return r.contractors.map((ic) => ({
        spInvoice: r.inv.spInvoiceNumber ?? '',
        projectNumber: projNum,
        project: r.inv.project ?? '',
        client: r.inv.client ?? '',
        contractor: ic.contractor,
        supplierInvoice: ic.supplierInvoiceNumber ?? '',
        hours: Number(ic.hours) || 0,
        contractorStatus: ic.paid ? 'Paid' : 'Pending',
        invoiceStatus: r.inv.status,
        dueDate: r.dueDate ?? '',
        paymentDate: ic.paymentDate ?? '',
      }))
    })
    exportGrid({ rows: exportRows, columns: cols, title: 'Payments', gridName: 'payments', format, generatedBy: user?.email ?? '' })
  }

  // Bloque "a pagar" de un allocation invoice-less (overage / sp_internal): horas
  // aprobadas y sin pagar por contractor.
  function renderToPay(allocation, pending) {
    const label = PAY_LABELS[allocation]
    return (
      <section className="pay-overage">
        <div className="toolbar">
          <span className="toolbar__count">
            {label.cap} to pay · {pending.length}{' '}
            {pending.length === 1 ? 'contractor' : 'contractors'}
          </span>
        </div>
        {pending.length === 0 ? (
          <div className="empty">No pending {label.low} hours to pay.</div>
        ) : (
          <div className="table-wrap table-wrap--scroll">
            <table className="table proj-table">
              <thead>
                <tr>
                  <th scope="col">Contractor</th>
                  <th scope="col" className="col-num">Hours</th>
                  <th scope="col" style={{ width: 160 }} />
                </tr>
              </thead>
              <tbody>
                {pending.map((group) => {
                  const key = `${allocation}:${group.user}`
                  const open = isExpanded(key)
                  const detailId = detailIdFor(key)
                  return (
                    <Fragment key={key}>
                      <tr>
                        <td className="cell-strong">
                          <PayExpandCell
                            open={open}
                            onToggle={() => toggleExpand(key)}
                            name={group.user || '—'}
                            meta={group.meta}
                            controls={detailId}
                          />
                        </td>
                        <td className="col-num cell-mono">{formatHours(group.hours)} h</td>
                        <td>
                          {can('payments.create') && (
                            <button
                              type="button"
                              className="btn btn--pay btn--row"
                              onClick={() => {
                                // El picker muestra las pendientes (seleccionables) MÁS las
                                // ya pagadas de este contractor+allocation (read-only, badge
                                // "Paid"), para ver el estado de cada hora. pendingCount
                                // guarda cuántas son pendientes (las pagadas no cuentan para
                                // "X of Y" ni para la selección).
                                const paidRows =
                                  allocation === 'overage' ? overagePaid : spInternalPaid
                                const pendingIds = new Set(
                                  group.entries.map((e) => String(e.id)),
                                )
                                // Dedup por id: un id repetido (misma hora en dos pagos, o ya
                                // presente entre las pendientes) rompería el key de React.
                                const seen = new Set()
                                const paidEntries = paidRows
                                  .filter((r) => r.user === group.user)
                                  .flatMap((r) => r.entries)
                                  .filter((e) => {
                                    const k = String(e.id)
                                    if (pendingIds.has(k) || seen.has(k)) return false
                                    // Respetar el filtro de la barra: no mostrar historial
                                    // pagado de otros clientes/proyectos cuando hay filtro.
                                    if (matchingEntryIds && !matchingEntryIds.has(k)) return false
                                    seen.add(k)
                                    return true
                                  })
                                  // Más recientes primero, y acotadas: mostrar historial pagado
                                  // como contexto sin arrastrar TODO (crece sin límite y sepulta
                                  // las pendientes seleccionables).
                                  .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
                                  .slice(0, PAID_PICKER_LIMIT)
                                setPayTarget({
                                  ...group,
                                  allocation,
                                  entries: [...group.entries, ...paidEntries],
                                  pendingCount: group.entries.length,
                                })
                                // Pre-seleccionar SÓLO las horas que pasan el filtro de la
                                // barra: con un filtro de cliente/proyecto activo, no
                                // pre-pagar las horas del grupo que quedan fuera del filtro.
                                const preselect = matchingEntryIds
                                  ? group.entryIds.filter((id) => matchingEntryIds.has(String(id)))
                                  : group.entryIds
                                setPaySelectedIds(new Set(preselect.map(String)))
                              }}
                            >
                              Pay {label.low}
                            </button>
                          )}
                        </td>
                      </tr>
                      {open && (
                        <tr id={detailId} className="pay-detail-row">
                          <td colSpan={3}>
                            <EntryBreakdown entries={group.entries} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    )
  }

  // Bloque "ya pagado" (read-only) de un allocation invoice-less, en horas.
  function renderPaid(allocation, paidRows) {
    if (paidRows.length === 0) return null
    const label = PAY_LABELS[allocation]
    return (
      <section className="pay-overage">
        <div className="toolbar">
          <span className="toolbar__count">
            {label.cap} paid · {paidRows.length} {paidRows.length === 1 ? 'payment' : 'payments'}
          </span>
        </div>
        <div className="table-wrap table-wrap--scroll">
          <table className="table proj-table">
            <thead>
              <tr>
                <th scope="col">Contractor</th>
                <th scope="col" className="col-num">Hours</th>
                <th scope="col">Paid on</th>
              </tr>
            </thead>
            <tbody>
              {paidRows.map((row) => {
                const key = `paid:${row.id}`
                const open = isExpanded(key)
                const detailId = detailIdFor(key)
                return (
                  <Fragment key={row.id}>
                    <tr className="row-static">
                      <td className="cell-strong">
                        <PayExpandCell
                          open={open}
                          onToggle={() => toggleExpand(key)}
                          name={row.user || '—'}
                          meta={row.meta}
                          controls={detailId}
                        />
                      </td>
                      <td className="col-num cell-mono">
                        {formatHours(row.hours)} h
                        <span className="cell-soft"> · {row.entryCount}</span>
                      </td>
                      <td className="cell-mono">{formatDate(row.paymentDate)}</td>
                    </tr>
                    {open && (
                      <tr id={detailId} className="pay-detail-row">
                        <td colSpan={3}>
                          <EntryBreakdown entries={row.entries} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    )
  }

  return (
    <>
      <motion.header
        className="masthead"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="masthead__top">
          <span className="masthead__kicker">Contractor payments</span>
          <span className="masthead__rule" aria-hidden="true" />
        </div>
        <h1 className="masthead__title">Payments</h1>
      </motion.header>

      {status === 'loading' && <p className="state__hint">Loading invoices…</p>}
      {status === 'error' && (
        <div className="state state--error">
          <AlertTriangle size={28} strokeWidth={1.8} />
          <h2 className="state__title">Could not load Payments</h2>
        </div>
      )}

      {status === 'ready' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.05 }}
        >
          <EntryFilterBar
            dimensions={filterDimensions}
            filters={combinedFilters}
            onToggle={onFilterToggle}
            onClear={onFilterClear}
            isActive={paymentFilterActive}
            title="Payment filters"
          />

          <div className="proj-kpis">
            <div className="proj-kpis__chips" role="group" aria-label="Payment alerts">
              <button
                type="button"
                className={`proj-kpi proj-kpi--overdue${alertFilter === 'overdue' ? ' is-active' : ''}`}
                onClick={() => setAlertFilter((c) => (c === 'overdue' ? null : 'overdue'))}
                aria-pressed={alertFilter === 'overdue'}
              >
                <span className="proj-kpi__count">{kpis.overdue}</span>
                <span className="proj-kpi__label">Overdue payments</span>
              </button>
              <button
                type="button"
                className={`proj-kpi proj-kpi--warning${alertFilter === 'dueThisWeek' ? ' is-active' : ''}`}
                onClick={() => setAlertFilter((c) => (c === 'dueThisWeek' ? null : 'dueThisWeek'))}
                aria-pressed={alertFilter === 'dueThisWeek'}
              >
                <span className="proj-kpi__count">{kpis.dueThisWeek}</span>
                <span className="proj-kpi__label">Due this week</span>
              </button>
              <div className="proj-kpi proj-kpi--total">
                <span className="proj-kpi__count">{formatHours(kpis.pendingHours)} h</span>
                <span className="proj-kpi__label">Hours pending</span>
              </div>
            </div>
            {can('settings.view') && (
              <Link to="/payment-alerts" className="btn btn--ghost proj-alerts-link">
                <BellRing size={15} aria-hidden="true" />
                Alert settings
              </Link>
            )}
          </div>

          <div className="toolbar">
            <label className="settings-check toolbar__toggle">
              <input
                type="checkbox"
                checked={showPaid}
                onChange={(e) => setShowPaid(e.target.checked)}
              />
              Show paid
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <ExportDropdown onExport={handleExport} />
              <span className="toolbar__count">
                {rows.length} {rows.length === 1 ? 'invoice' : 'invoices'}
              </span>
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="empty">No pending contractor invoices to pay.</div>
          ) : (
            <div className="table-wrap table-wrap--scroll">
              <table className="table proj-table coll-table">
                <thead>
                  <tr>
                    <th scope="col">Contractor</th>
                    <th scope="col">Supplier Invoice #</th>
                    <th scope="col" className="col-num">Hours</th>
                    <th scope="col">Status</th>
                    <th scope="col" />
                  </tr>
                </thead>
                {rows.map((r) => {
                  const payable = isPayable(r.inv.status)
                  const overdue = payable && r.alertLevel === 'overdue'
                  const warning = payable && r.alertLevel === 'warning'
                  const projNum = projectNumberFor(r.inv.project)
                  return (
                    <tbody key={r.inv.id} className="pay-invoice-group">
                      <tr className="pay-invoice-head">
                        <td colSpan={5}>
                          <div className="pay-invoice-head__row">
                            <span className="cell-strong cell-mono">
                              {r.inv.spInvoiceNumber ?? '—'}
                            </span>
                            <span className="cell-soft">
                              {projNum && (
                                <span className="pay-invoice-head__num cell-mono">{projNum}</span>
                              )}
                              {r.inv.project || '—'}
                              {r.inv.client ? ` · ${r.inv.client}` : ''}
                              {r.period ? ` · ${r.period}` : ''}
                            </span>
                            <span className="cell-soft">
                              {r.paidCount}/{r.totalCount} paid · {formatHours(r.totalHours)} h
                            </span>
                            <BillingBadge status={r.inv.status} />
                            {r.dueDate && (
                              <span
                                className={`cell-soft${overdue ? ' proj-days--overdue' : ''}`}
                              >
                                due {formatDate(r.dueDate)}
                                {overdue ? (
                                  <span className="badge badge--expired"> Overdue</span>
                                ) : warning ? (
                                  <span className="badge badge--critical"> Warning</span>
                                ) : null}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                      {r.contractors.map((ic) => {
                        const key = `inv:${ic.id}`
                        const open = isExpanded(key)
                        const detailId = detailIdFor(key)
                        // Proyecto/cliente/semana ya están en el header del grupo; la
                        // fila agrega el rango de semanas de ESTE contractor (ic.weeks,
                        // precomputado) y el detalle por hora (ic.entries) al expandir.
                        return (
                          <Fragment key={ic.id}>
                            <tr className={ic.paid ? 'row-static' : ''}>
                              <td>
                                <PayExpandCell
                                  open={open}
                                  onToggle={() => toggleExpand(key)}
                                  name={ic.contractor}
                                  meta={ic.weeks}
                                  controls={detailId}
                                />
                              </td>
                              <td className="cell-mono">{ic.supplierInvoiceNumber ?? '—'}</td>
                              <td className="col-num cell-mono">{formatHours(ic.hours)} h</td>
                              <td>
                                {ic.paid ? (
                                  <span className="badge badge--ok">Paid</span>
                                ) : (
                                  <span className="cell-pop-empty">Pending</span>
                                )}
                              </td>
                              <td>
                                {!ic.paid && payable && can('payments.create') ? (
                                  <button
                                    type="button"
                                    className="btn btn--pay btn--row"
                                    onClick={() => setPayTargetContractor({ invoice: r.inv, ic })}
                                  >
                                    Register Payment
                                  </button>
                                ) : ic.paid ? (
                                  <button
                                    type="button"
                                    className="btn btn--ghost btn--row"
                                    onClick={() => handleDownload(r.inv, ic)}
                                  >
                                    <Download size={14} aria-hidden="true" />
                                    Receipt
                                  </button>
                                ) : null}
                              </td>
                            </tr>
                            {open && (
                              <tr id={detailId} className="pay-detail-row">
                                <td colSpan={5}>
                                  <EntryBreakdown entries={ic.entries} />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  )
                })}
              </table>
            </div>
          )}

          {/* Secciones invoice-less (overage / sp_internal): se filtran sólo por horas
              (cliente/proyecto/#/contractor). El "Estado" es de PAGO de factura y no aplica
              acá, así que con un filtro de Estado activo se ocultan del todo — si no, un
              filtro "Paid" dejaría a la vista listas de "to pay" (pendientes) contradictorias. */}
          {paymentStatuses.length === 0 && (
            <>
              {renderToPay('overage', overagePendingF)}
              {renderToPay('sp_internal', spInternalPendingF)}
              {renderPaid('overage', overagePaidF)}
              {renderPaid('sp_internal', spInternalPaidF)}
            </>
          )}
        </motion.div>
      )}

      <AnimatePresence>
        {payTargetContractor && (
          <RegisterPaymentModal
            key={`payc-${payTargetContractor.ic.id}`}
            requireSupplierNumber
            title="Register contractor payment"
            submitLabel="Register payment"
            summaryName={payTargetContractor.ic.contractor}
            summaryMeta={`${payTargetContractor.invoice.spInvoiceNumber ?? 'Invoice'} · ${
              payTargetContractor.invoice.project ?? '—'
            }`}
            summaryFigure={`${formatHours(payTargetContractor.ic.hours)} h`}
            summaryFigureLabel="Hours to pay"
            footerNote={
              <>
                Registers this contractor’s payment. The invoice moves to{' '}
                <strong>Paid</strong> once every contractor is paid.
              </>
            }
            onClose={() => setPayTargetContractor(null)}
            onConfirm={handlePayContractor}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {payTarget &&
          (() => {
            const label = PAY_LABELS[payTarget.allocation]
            // Sólo las pendientes son seleccionables/pagables: las pagadas van
            // read-only en el picker (checkbox deshabilitado), así que se excluyen
            // de la selección de forma defensiva aunque no puedan togglearse.
            const selected = payTarget.entries.filter(
              (e) => paySelectedIds.has(String(e.id)) && isPending(e),
            )
            const selHours = selected.reduce((sum, e) => sum + e.hours, 0)
            const toggle = (id) =>
              setPaySelectedIds((prev) => {
                const next = new Set(prev)
                const k = String(id)
                if (next.has(k)) next.delete(k)
                else next.add(k)
                return next
              })
            return (
              <RegisterPaymentModal
                key={`${payTarget.allocation}-${payTarget.user}`}
                title={`Register ${label.low} payment`}
                submitLabel={`Register ${label.low} payment`}
                extraValid={selected.length > 0}
                summaryName={payTarget.user}
                summaryMeta={`${label.cap} · ${selected.length} of ${payTarget.pendingCount} ${
                  payTarget.pendingCount === 1 ? 'entry' : 'entries'
                }`}
                summaryFigure={`${formatHours(selHours)} h`}
                summaryFigureLabel={`${label.cap} hours (selected)`}
                extraContent={
                  <div className="overage-picker">
                    <span className="overage-picker__title">Hours to pay</span>
                    <ul className="overage-picker__list">
                      {payTarget.entries.map((e) => {
                        const status = entryPaymentStatus(e, paidEntryIds)
                        const isPaid = status === 'paid'
                        return (
                          <li key={e.id}>
                            <label
                              className={`overage-picker__row${isPaid ? ' overage-picker__row--paid' : ''}`}
                            >
                              <input
                                type="checkbox"
                                checked={paySelectedIds.has(String(e.id))}
                                disabled={isPaid}
                                onChange={() => toggle(e.id)}
                              />
                              <span className="overage-picker__desc">
                                {e.project || '—'}
                                {e.task ? ` · ${e.task}` : ''}
                                {e.date ? ` · ${formatDate(e.date)}` : ''}
                              </span>
                              <span className="overage-picker__hours">{formatHours(e.hours)} h</span>
                              {/* Indicador pasivo: pointer-events:none (CSS) deja pasar el
                                  click al <label>, así clickear el badge de una fila pendiente
                                  la togglea igual que el resto de la fila. */}
                              <span className={`badge badge--${status}`}>
                                {isPaid ? 'Paid' : 'Pending'}
                              </span>
                            </label>
                          </li>
                        )
                      })}
                    </ul>
                    {selected.length === 0 && (
                      <span className="field__error">Select at least one hour to pay.</span>
                    )}
                  </div>
                }
                footerNote={
                  <>
                    Registers a contractor payment for the selected {label.low} hours (no
                    invoice). They’ll be frozen and drop off the pending list.
                  </>
                }
                onClose={() => setPayTarget(null)}
                onConfirm={handleRegisterPayment}
              />
            )
          })()}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <Toast key={toast.id} message={toast.message} tone={toast.tone}
            onDismiss={() => setToast(null)} />
        )}
      </AnimatePresence>
    </>
  )
}
