import { useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  Clock,
  CreditCard,
  FileText,
  Plus,
  Receipt,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { HoursDonut } from '../components/HoursDonut'
import { api } from '../lib/api'
import { useSyncReloadKey } from '../lib/useSyncReload'
import { ALLOCATION_LABELS } from '../lib/allocations'
import { deriveEntriesClient } from '../lib/entryClient'
import {
  useEntryFilters,
  applyEntryFilters,
  buildFilterOptions,
  clientFilterOptions,
  OTHER_CLIENT,
} from '../lib/useEntryFilters'
import { buildClientResolver } from '../lib/clientResolver'
import { allowedProjectNames, matchesClient, matchesProjectName } from '../lib/dashboardScope'
import { EntryFilterBar } from '../components/EntryFilterBar'
import { BILLING_STATUSES } from '../lib/data'
import { ContractsExpiringWidget } from '../components/dashboard/ContractsExpiringWidget'
import { SupplierContractsWidget } from '../components/dashboard/SupplierContractsWidget'
import { Sparkline } from '../components/Sparkline'

const STATUS_COLORS = {
  Pending: '#52525B',
  Invoiced: '#F59E0B',
  Collected: '#00BFD4',
  Paid: '#10B981',
}

// Facturable pendiente = misma definición que Billing (billingGrouping.js:175):
// allocation bill_to_client + Approved, y todavía sin factura. Fuente única para el
// KPI Pending Hours, su sparkline y el bucket "Pending" del donut — deben coincidir.
function isBillablePending(entry, invoiceByEntryId) {
  return (
    entry.status === 'Approved' &&
    entry.allocation === 'bill_to_client' &&
    !invoiceByEntryId.has(String(entry.id))
  )
}

// Orden fijo del donut de allocation: sin clasificar primero, después las cuatro
// categorías reales (null + los valores del CHECK 0034). El label sale del mapa
// compartido ALLOCATION_LABELS para no divergir de Entries/Billing; null → "Unallocated".
const ALLOCATION_ORDER = [null, 'bill_to_client', 'overage', 'sp_internal', 'unknown']
const allocationName = (key) => (key == null ? 'Unallocated' : ALLOCATION_LABELS[key]?.label ?? key)

// Colores del donut de allocation, keyados por la allocation KEY estable (no por el
// label visible): así renombrar un label en ALLOCATION_LABELS no tira el color al
// fallback. Espejan los badges badge--alloc-*: teal primary, naranja overage, violeta
// SP internal, slate X. Unallocated (null) se resuelve aparte (mismo gris que Pending),
// sin depender de que null coaccione a la string 'null' como clave de objeto.
const UNALLOCATED_COLOR = '#52525B'
const ALLOCATION_COLORS = {
  bill_to_client: '#00BFD4',
  overage: '#FB923C',
  sp_internal: '#8B5CF6',
  unknown: '#64748B',
}
const allocationColor = (key) =>
  key == null ? UNALLOCATED_COLOR : ALLOCATION_COLORS[key] ?? '#6b7280'

function addDaysISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) + days * 86400000).toISOString().slice(0, 10)
}

function daysUntilDate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const target = Date.UTC(y, m - 1, d)
  const now = new Date()
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.round((target - today) / 86400000)
}

// Serie de 7 puntos (uno por día, últimos 7 días incluyendo hoy) para las
// sparklines de las KPI cards. `valueKey` ausente → cuenta ocurrencias.
function last7DaysSeries(items, dateKey, valueKey) {
  const now = new Date()
  const days = []
  for (let i = 6; i >= 0; i -= 1) {
    days.push(
      new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i),
      )
        .toISOString()
        .slice(0, 10),
    )
  }
  const sums = Object.fromEntries(days.map((d) => [d, 0]))
  for (const item of items) {
    const iso = item[dateKey]
    if (iso in sums) sums[iso] += valueKey ? item[valueKey] : 1
  }
  return days.map((d) => sums[d])
}

export function DashboardPage() {
  const { can } = useOutletContext()
  const [data, setData] = useState(null)
  // projects/clients viven APARTE del data core: cargan en su propia cadena (no bloquean
  // el first paint) y se guardan acá para alimentar el filtro. Estado separado a propósito
  // — si se mergearan al `data` core con setData(prev=>...), un race donde llegan antes que
  // el core los perdería (prev === null).
  const [filterData, setFilterData] = useState({ projects: [], clients: [] })
  // ¿Ya cargó al menos una vez projects/clients? Alimenta el filtro Y el scope de los
  // widgets (masterNames sale de filterData.clients). Se usa para NO mostrar un estado
  // vacío en el widget de contratos mientras carga, y queda true entre reloads.
  const [filtersLoaded, setFiltersLoaded] = useState(false)
  const [loadStatus, setLoadStatus] = useState('loading')

  const reloadKey = useSyncReloadKey()
  useEffect(() => {
    let cancelled = false
    setLoadStatus('loading')
    // NO se resetea filterData en cada recarga: si se vaciara, masterNames quedaría vacío
    // y —con un filtro de Cliente activo— matchesClient mandaría TODAS las facturas/
    // proyectos al centinela Others → los tiles de plata y los contratos parpadearían a 0
    // durante el refresh (con `data` todavía viejo). Se conserva el filterData previo y el
    // nuevo fetch lo pisa al resolver (los proyectos/clientes casi no cambian entre syncs).
    // Datos CORE (KPIs y donuts): bloquean el first paint.
    Promise.all([
      api.timeEntries.list(),
      api.invoices.list(),
      api.collections.list(),
      api.payments.list(),
    ])
      .then(([entries, invoices, collections, payments]) => {
        if (cancelled) return
        setData({ entries, invoices, collections, payments })
        setLoadStatus('ready')
      })
      .catch((err) => {
        if (cancelled) return
        console.error('Dashboard load error:', err)
        setLoadStatus('error')
      })

    // projects/clients sólo resuelven el cliente de cada hora (deriveEntriesClient) para el
    // filtro: NO bloquean el first paint (los KPIs/donuts se ven ya) y sólo hidratan las
    // opciones del filtro cuando llegan. Estado propio (filterData), así que no hay race con
    // el core. Un fallo suyo degrada a [] (filtro con menos opciones), sin tirar el dashboard.
    Promise.all([
      Promise.resolve().then(() => api.projects.list()).catch(() => []),
      Promise.resolve().then(() => api.clients.list()).catch(() => []),
    ]).then(([projects, clients]) => {
      if (cancelled) return
      setFilterData({ projects, clients })
      setFiltersLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  // Map: entryId (string) → invoice
  const invoiceByEntryId = useMemo(() => {
    if (!data) return new Map()
    const m = new Map()
    for (const inv of data.invoices) {
      for (const eid of inv.entryIds) m.set(String(eid), inv)
    }
    return m
  }, [data])

  // --- Filtros (misma barra que Billing/Payments) --------------------------------
  // Filtran los widgets basados en HORAS (donuts, Pending Hours, total). Los tiles de
  // facturas (Invoices/Collections/Payments) quedan globales. "Status" = billing status.
  const enrichedEntries = useMemo(
    () => (data ? deriveEntriesClient(data.entries, filterData.projects, filterData.clients) : []),
    [data, filterData],
  )
  const { filters, toggleValue, clear, isActive } = useEntryFilters()
  const masterNames = useMemo(
    () => new Set(filterData.clients.map((c) => c.clientName).filter(Boolean)),
    [filterData],
  )
  const filterOptions = useMemo(
    () => buildFilterOptions(enrichedEntries, filters, invoiceByEntryId, masterNames),
    [enrichedEntries, filters, invoiceByEntryId, masterNames],
  )
  const filteredEntries = useMemo(
    () => applyEntryFilters(enrichedEntries, filters, invoiceByEntryId, masterNames),
    [enrichedEntries, filters, invoiceByEntryId, masterNames],
  )
  // Client dropdown = maestro de clientes (mismo criterio que Billing/Entries/Projects):
  // lista todos los clientes de la página Clients + el centinela Others si aplica.
  const clientOptions = useMemo(
    () => clientFilterOptions(filterData.clients, filterOptions.clients.includes(OTHER_CLIENT)),
    [filterData, filterOptions.clients],
  )
  const filterDimensions = useMemo(
    () => [
      { key: 'clients', label: 'Client', options: clientOptions },
      { key: 'projectNumbers', label: 'Project #', options: filterOptions.projectNumbers },
      { key: 'projects', label: 'Project', options: filterOptions.projects },
      { key: 'contractors', label: 'Contractor', options: filterOptions.contractors },
      // "Status" del Dashboard = estado de FACTURACIÓN de la hora (billingStatuses de
      // useEntryFilters), el estado natural de una entry acá (los widgets son de horas).
      { key: 'billingStatuses', label: 'Status', options: BILLING_STATUSES },
    ],
    [clientOptions, filterOptions],
  )

  // --- Alcance Cliente/Proyecto para TODOS los widgets --------------------------
  // Las dimensiones Cliente + Proyecto (incluye Project#) filtran también los tiles de
  // plata (Invoices/Collections/Payments) y los contratos de proyecto — no sólo los
  // widgets de horas. Contractor/Status siguen aplicando sólo a horas (y Contractor a
  // Supplier Contracts, por supplierName). Sin filtro de cliente/proyecto, los predicados
  // dejan pasar todo (matchesClient/matchesProjectName → true), así el default no cambia.
  const resolveProjectClient = useMemo(() => buildClientResolver(filterData.clients), [filterData.clients])
  const scopeAllowedNames = useMemo(
    () => allowedProjectNames(filters, filterData.projects),
    [filters, filterData.projects],
  )
  // Proyectos que pasan el filtro Cliente/Proyecto: alimentan el widget de contratos por
  // vencimiento (un contrato pertenece al cliente de SU proyecto, resuelto por grupo).
  const scopedProjects = useMemo(
    () =>
      filterData.projects.filter(
        (p) =>
          matchesClient(resolveProjectClient(p).client ?? '', filters.clients, masterNames) &&
          matchesProjectName(p.projectName, scopeAllowedNames),
      ),
    [filterData.projects, resolveProjectClient, filters.clients, masterNames, scopeAllowedNames],
  )
  // Facturas en scope (invoice.client / invoice.project). Cobros y pagos siguen a su
  // factura (invoiceId), así heredan el mismo recorte de cliente/proyecto.
  // invoice.client se persiste al emitir como el cliente MAESTRO ya resuelto (createGrouped
  // lo toma de la selección de la grilla, que usa el mismo resolver), así que matchear el
  // crudo con clientFilterKey es consistente con el camino resuelto de los proyectos.
  const scopedInvoices = useMemo(
    () =>
      data
        ? data.invoices.filter(
            (inv) =>
              matchesClient(inv.client ?? '', filters.clients, masterNames) &&
              matchesProjectName(inv.project, scopeAllowedNames),
          )
        : [],
    [data, filters.clients, masterNames, scopeAllowedNames],
  )
  const scopedInvoiceIds = useMemo(() => new Set(scopedInvoices.map((i) => i.id)), [scopedInvoices])
  const scopedCollections = useMemo(
    () => (data ? data.collections.filter((c) => scopedInvoiceIds.has(c.invoiceId)) : []),
    [data, scopedInvoiceIds],
  )
  const scopedPayments = useMemo(
    () => (data ? data.payments.filter((p) => scopedInvoiceIds.has(p.invoiceId)) : []),
    [data, scopedInvoiceIds],
  )

  // Map: invoiceId → last collection date (sobre los cobros en scope: el KPI de pagos
  // por vencer sólo mira facturas en scope, así que alcanza con los cobros de esas).
  const lastCollDateByInvoiceId = useMemo(() => {
    const m = new Map()
    for (const c of scopedCollections) {
      const prev = m.get(c.invoiceId)
      if (!prev || c.collectionDate > prev) m.set(c.invoiceId, c.collectionDate)
    }
    return m
  }, [scopedCollections])

  // Horas facturables pendientes (isBillablePending): Rejected/Pending y overage/
  // sp_internal/sin triagear no se facturan al cliente. Un solo memo alimenta el número
  // (Pending Hours) y su sparkline — el único KPI que responde al filtro (el resto son de
  // facturas y quedan globales, por eso aparte, para no recomputarlos en cada toggle).
  const unbilledEntries = useMemo(
    () => filteredEntries.filter((e) => isBillablePending(e, invoiceByEntryId)),
    [filteredEntries, invoiceByEntryId],
  )
  const pendingHours = useMemo(
    () => unbilledEntries.reduce((sum, e) => sum + e.hours, 0),
    [unbilledEntries],
  )

  const kpis = useMemo(() => {
    if (!data) return null
    const now = new Date()
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

    // Las facturas agrupadas (modelo en horas) no cargan invoice_date; se usa la fecha
    // de emisión (created_at) como fecha de la factura para el KPI/sparkline.
    const issuedDateOf = (i) =>
      i.invoiceDate ?? (i.createdAt ? String(i.createdAt).slice(0, 10) : '')
    const invoicesThisMonth = scopedInvoices.filter((i) =>
      issuedDateOf(i).startsWith(thisMonth),
    ).length

    const collectionsPending = scopedInvoices.filter((i) => i.status === 'Invoiced').length

    let paymentsDueThisWeek = 0
    for (const inv of scopedInvoices) {
      if (inv.status !== 'Collected') continue
      const lastCol = lastCollDateByInvoiceId.get(inv.id) ?? inv.invoiceDate
      if (!lastCol) continue
      const due = addDaysISO(lastCol, inv.paymentTermsDays ?? 30)
      const d = daysUntilDate(due)
      if (d >= 0 && d <= 7) paymentsDueThisWeek += 1
    }

    return { invoicesThisMonth, collectionsPending, paymentsDueThisWeek }
  }, [data, scopedInvoices, lastCollDateByInvoiceId])

  // Sparkline de Pending Hours: sobre el mismo subconjunto filtrado.
  const pendingHoursSparkline = useMemo(
    () => last7DaysSeries(unbilledEntries, 'date', 'hours'),
    [unbilledEntries],
  )

  // Micro-visual de cada KPI card: actividad real de los últimos 7 días en el
  // dominio de esa card (no repite el número de la card, da contexto de tendencia).
  const sparklines = useMemo(() => {
    if (!data) return null
    return {
      // issuedDate = invoice_date o, si falta (facturas agrupadas), la fecha de creación.
      // Sobre las listas EN SCOPE, para que la tendencia acompañe al número filtrado.
      invoicesThisMonth: last7DaysSeries(
        scopedInvoices.map((i) => ({
          ...i,
          issuedDate: i.invoiceDate ?? (i.createdAt ? String(i.createdAt).slice(0, 10) : null),
        })),
        'issuedDate',
      ),
      collectionsPending: last7DaysSeries(scopedCollections, 'collectionDate'),
      paymentsDueThisWeek: last7DaysSeries(scopedPayments, 'paymentDate'),
    }
  }, [data, scopedInvoices, scopedCollections, scopedPayments])

  // Donut de billing: horas por estado de factura. Devuelve las slices Y su total propio
  // (suma de las horas que reparte = facturadas + facturables-pendientes). El donut usa
  // ESE total como centro, no totalHours: si no, las horas no-facturables (overage/
  // sp_internal/sin triagear) inflarían el centro sobre la suma de sus slices.
  const billing = useMemo(() => {
    const sums = { Pending: 0, Invoiced: 0, Collected: 0, Paid: 0 }
    let total = 0
    for (const e of filteredEntries) {
      const inv = invoiceByEntryId.get(String(e.id))
      // Facturada → cuenta bajo el estado de su factura (una vez emitida, la factura
      // es la fuente de verdad). Sin factura → sólo entra como "Pending" si es
      // facturable al cliente (Approved + bill_to_client), igual que Billing.
      if (inv) {
        sums[inv.status] = (sums[inv.status] || 0) + e.hours
        total += e.hours
      } else if (isBillablePending(e, invoiceByEntryId)) {
        sums.Pending += e.hours
        total += e.hours
      }
    }
    const dist = Object.entries(sums)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({
        key: name,
        name,
        value: Number(value.toFixed(1)),
        color: STATUS_COLORS[name] ?? '#6b7280',
      }))
    return { dist, total: Number(total.toFixed(1)) }
  }, [filteredEntries, invoiceByEntryId])

  // Mismas horas que el donut de billing, pero repartidas por allocation en vez de
  // por estado de factura. Las categorías conocidas (null + los 4 valores del CHECK
  // 0034) se muestran en orden fijo; si apareciera una allocation fuera de ese set
  // (p. ej. si el CHECK se ampliara) se agrega al final en vez de descartar sus horas
  // en silencio. El color sale de la KEY estable, no del label visible.
  const allocationDist = useMemo(() => {
    const sums = new Map()
    for (const e of filteredEntries) {
      const key = e.allocation ?? null
      sums.set(key, (sums.get(key) || 0) + e.hours)
    }
    const orderedKeys = [
      ...ALLOCATION_ORDER,
      ...[...sums.keys()].filter((k) => !ALLOCATION_ORDER.includes(k)),
    ]
    return orderedKeys
      .map((key) => ({
        key: key == null ? 'unallocated' : String(key),
        name: allocationName(key),
        value: Number((sums.get(key) || 0).toFixed(1)),
        color: allocationColor(key),
      }))
      .filter((d) => d.value > 0)
  }, [filteredEntries])

  // Total del centro del donut de ALLOCATION: reparte TODAS las horas filtradas, así que
  // su suma = este total. Se calcula UNA vez sobre las horas crudas y se redondea una sola
  // vez, para que el centro no drifte por el redondeo por-bucket (dos entries de 0.25 h dan
  // 0.5 juntas pero 0.3+0.3=0.6 separadas). El donut de BILLING usa su propio total
  // (billing.total), que excluye las no-facturables — así su centro no incluye horas que
  // sus slices no muestran (puede diferir 0.1 de la suma de la leyenda por el redondeo
  // por-bucket, el mismo compromiso que el donut de Allocation).
  // Memoizado sobre [filteredEntries] (que ya deriva de data).
  const totalHours = useMemo(
    () => filteredEntries.reduce((sum, e) => sum + e.hours, 0),
    [filteredEntries],
  )

  const now = new Date()
  const monthLabel = now.toLocaleString('en', { month: 'long', year: 'numeric' })

  return (
    <>
      <motion.header
        className="masthead"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="masthead__top">
          <span className="masthead__kicker">{monthLabel} overview</span>
          <span className="masthead__rule" aria-hidden="true" />
        </div>
        <h1 className="masthead__title">Dashboard</h1>
      </motion.header>

      {loadStatus === 'error' && (
        <div className="state state--error">
          <AlertTriangle size={28} strokeWidth={1.8} />
          <h2 className="state__title">Could not load dashboard data</h2>
          <p className="state__text">Check your connection and try again.</p>
        </div>
      )}

      {loadStatus === 'loading' && <p className="state__hint">Loading dashboard…</p>}

      {loadStatus === 'ready' && kpis && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.05 }}
        >
          {/* Client / Project filtran TODO el dashboard (KPIs, donuts, facturas/cobros/
              pagos y contratos). Contractor / Status siguen aplicando sólo a los widgets
              de horas; Contractor además filtra Supplier Contracts (por proveedor). */}
          <EntryFilterBar
            dimensions={filterDimensions}
            filters={filters}
            onToggle={toggleValue}
            onClear={clear}
            isActive={isActive}
            title="Dashboard filters"
          />
          {isActive && (
            <p className="dash-filter-scope">
              Client and Project filters scope the whole dashboard. Contractor and Status
              apply to the hours widgets (the two donuts and hours totals); Contractor also
              filters Supplier Contracts. Supplier Contracts have no client, so the Client
              filter doesn’t affect them.
            </p>
          )}

          {/* KPI Cards */}
          <div className="dash-kpis">
            {can('billing.create') && (
              <>
                {/* Reemplazan a /time-entries, que salió del menú: las horas
                    sin facturar se miran en Entries y se facturan en Billing. */}
                <Link to="/entries" className="dash-kpi">
                  <div className="dash-kpi__head">
                    <span className="dash-kpi__icon">
                      <Clock size={17} aria-hidden="true" />
                    </span>
                    <Sparkline values={pendingHoursSparkline} />
                  </div>
                  <span className="dash-kpi__label">Pending Hours</span>
                  <span className="dash-kpi__value">
                    {pendingHours.toFixed(1)}
                    <span className="dash-kpi__unit"> h</span>
                  </span>
                  <span className="dash-kpi__hint">unbilled entries</span>
                </Link>
                <Link to="/billing" className="dash-kpi">
                  <div className="dash-kpi__head">
                    <span className="dash-kpi__icon">
                      <FileText size={17} aria-hidden="true" />
                    </span>
                    <Sparkline values={sparklines.invoicesThisMonth} />
                  </div>
                  <span className="dash-kpi__label">Invoices This Month</span>
                  <span className="dash-kpi__value">{kpis.invoicesThisMonth}</span>
                  <span className="dash-kpi__hint">{monthLabel}</span>
                </Link>
              </>
            )}
            <Link
              to="/collections"
              className={`dash-kpi${kpis.collectionsPending > 0 ? ' dash-kpi--warn' : ''}`}
            >
              <div className="dash-kpi__head">
                <span className="dash-kpi__icon">
                  <Wallet size={17} aria-hidden="true" />
                </span>
                <Sparkline values={sparklines.collectionsPending} />
              </div>
              <span className="dash-kpi__label">Collections Pending</span>
              <span className="dash-kpi__value">{kpis.collectionsPending}</span>
              <span className="dash-kpi__hint">invoiced, not yet collected</span>
            </Link>
            <Link
              to="/payments"
              className={`dash-kpi${kpis.paymentsDueThisWeek > 0 ? ' dash-kpi--urgent' : ''}`}
            >
              <div className="dash-kpi__head">
                <span className="dash-kpi__icon">
                  <CreditCard size={17} aria-hidden="true" />
                </span>
                <Sparkline values={sparklines.paymentsDueThisWeek} />
              </div>
              <span className="dash-kpi__label">Payments Due This Week</span>
              <span className="dash-kpi__value">{kpis.paymentsDueThisWeek}</span>
              <span className="dash-kpi__hint">next 7 days</span>
            </Link>
          </div>

          {/* Dos donuts: horas por estado de factura y por allocation, lado a lado. */}
          <div className="dash-main">
            {/* Título aclara "billable hours": este donut cuenta sólo las facturables, así
                que su centro puede ser menor que el del donut de Allocation (todas las horas). */}
            <HoursDonut
              icon={<TrendingUp size={14} />}
              title="Billing Status (billable hours)"
              data={billing.dist}
              total={billing.total}
            />
            <HoursDonut
              icon={<TrendingUp size={14} />}
              title="Allocation Hours Distribution"
              data={allocationDist}
              total={totalHours}
            />
          </div>

          {/* Contracts + Supplier Contracts en dos columnas, para equilibrar el
              ancho debajo de los donuts en vez de dejar la derecha vacía. Contracts sigue
              el filtro Cliente/Proyecto (scopedProjects); Supplier Contracts sólo el de
              Contractor (no tiene cliente en los datos). */}
          <div className="dash-secondary">
            <ContractsExpiringWidget limit={5} projects={scopedProjects} loading={!filtersLoaded} />
            <SupplierContractsWidget contractorFilter={filters.contractors} />
          </div>

          {/* Quick Actions */}
          <div className="dash-actions">
            {can('billing.create') && (
              <Link to="/billing" className="dash-action-btn">
                <FileText size={22} aria-hidden="true" />
                <span>Bill Hours</span>
              </Link>
            )}
            {can('collections.create') && (
              <Link to="/collections" className="dash-action-btn">
                <Receipt size={22} aria-hidden="true" />
                <span>Register Collection</span>
              </Link>
            )}
            {can('payments.create') && (
              <Link to="/payments" className="dash-action-btn">
                <CreditCard size={22} aria-hidden="true" />
                <span>Pay Contractor</span>
              </Link>
            )}
            {can('projects.create') && (
              <Link to="/projects" className="dash-action-btn">
                <Plus size={22} aria-hidden="true" />
                <span>New Project</span>
              </Link>
            )}
          </div>
        </motion.div>
      )}
    </>
  )
}
