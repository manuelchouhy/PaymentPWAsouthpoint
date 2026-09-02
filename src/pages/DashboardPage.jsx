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
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { api } from '../lib/api'
import { ALLOCATION_LABELS } from '../lib/allocations'
import { ContractsExpiringWidget } from '../components/dashboard/ContractsExpiringWidget'
import { SupplierContractsWidget } from '../components/dashboard/SupplierContractsWidget'
import { Sparkline } from '../components/Sparkline'

const STATUS_COLORS = {
  Pending: '#52525B',
  Invoiced: '#F59E0B',
  Collected: '#00BFD4',
  Paid: '#10B981',
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

// Donut de horas con el total en el centro y la leyenda a la derecha. Comparte
// marcado y estilos (billing-dist) entre el reparto por estado de factura y el
// reparto por allocation. Cada dato de `data` trae su propio `color` (así el
// color no depende de matchear el label visible con un mapa externo).
// `total` llega como prop a propósito (NO se deriva de `data`): es el total de
// horas crudo, compartido por los dos donuts, para que ambos centros muestren el
// mismo número. Sumar `data` reintroduciría el drift de redondeo entre donuts.
function HoursDonut({ icon, title, data, total }) {
  return (
    <div className="dash-widget">
      <div className="dash-widget__head">
        <span className="dash-widget__title">
          {icon}
          {title}
        </span>
      </div>
      {data.length === 0 ? (
        <p className="dash-widget__empty">No hour data available.</p>
      ) : (
        <div className="billing-dist">
          {/* Donut con el total en el centro (como el mockup). */}
          <div className="billing-dist__chart">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={64}
                  outerRadius={90}
                  paddingAngle={2}
                  dataKey="value"
                  isAnimationActive={false}
                >
                  {data.map((entry) => (
                    <Cell key={entry.key} fill={entry.color} stroke="transparent" />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => [`${value} h`, name]}
                  contentStyle={{
                    background: 'var(--surface)',
                    border: '1px solid var(--line-strong)',
                    borderRadius: 8,
                    fontSize: 12,
                    color: 'var(--text)',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="billing-dist__center" aria-hidden="true">
              <span className="billing-dist__total">{total.toFixed(1)}</span>
              <span className="billing-dist__unit">Hours</span>
            </div>
          </div>
          {/* Leyenda a la derecha con las horas de cada categoría. */}
          <ul className="billing-dist__legend">
            {data.map((entry) => (
              <li key={entry.key} className="billing-dist__row">
                <span className="billing-dist__dot" style={{ background: entry.color }} />
                <span className="billing-dist__name">{entry.name}</span>
                <span className="billing-dist__val">{entry.value.toFixed(1)} h</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export function DashboardPage() {
  const { can } = useOutletContext()
  const [data, setData] = useState(null)
  const [loadStatus, setLoadStatus] = useState('loading')

  useEffect(() => {
    let cancelled = false
    setLoadStatus('loading')
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
    return () => {
      cancelled = true
    }
  }, [])

  // Map: entryId (string) → invoice
  const invoiceByEntryId = useMemo(() => {
    if (!data) return new Map()
    const m = new Map()
    for (const inv of data.invoices) {
      for (const eid of inv.entryIds) m.set(String(eid), inv)
    }
    return m
  }, [data])

  // Map: invoiceId → last collection date
  const lastCollDateByInvoiceId = useMemo(() => {
    if (!data) return new Map()
    const m = new Map()
    for (const c of data.collections) {
      const prev = m.get(c.invoiceId)
      if (!prev || c.collectionDate > prev) m.set(c.invoiceId, c.collectionDate)
    }
    return m
  }, [data])

  const kpis = useMemo(() => {
    if (!data) return null
    const now = new Date()
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

    // Sólo horas facturables al cliente: allocation bill_to_client + Approved y
    // todavía sin factura — misma definición que Billing (billingGrouping.js:175).
    // Las Rejected/Pending y las overage/sp_internal/sin triagear no se facturan al
    // cliente, así que no cuentan como "pendientes a facturar".
    const pendingHours = data.entries
      .filter(
        (e) =>
          e.status === 'Approved' &&
          e.allocation === 'bill_to_client' &&
          !invoiceByEntryId.has(String(e.id)),
      )
      .reduce((sum, e) => sum + e.hours, 0)

    const invoicesThisMonth = data.invoices.filter((i) =>
      (i.invoiceDate ?? '').startsWith(thisMonth),
    ).length

    const collectionsPending = data.invoices.filter((i) => i.status === 'Invoiced').length

    let paymentsDueThisWeek = 0
    for (const inv of data.invoices) {
      if (inv.status !== 'Collected') continue
      const lastCol = lastCollDateByInvoiceId.get(inv.id) ?? inv.invoiceDate
      if (!lastCol) continue
      const due = addDaysISO(lastCol, inv.paymentTermsDays ?? 30)
      const d = daysUntilDate(due)
      if (d >= 0 && d <= 7) paymentsDueThisWeek += 1
    }

    return { pendingHours, invoicesThisMonth, collectionsPending, paymentsDueThisWeek }
  }, [data, invoiceByEntryId, lastCollDateByInvoiceId])

  // Micro-visual de cada KPI card: actividad real de los últimos 7 días en el
  // dominio de esa card (no repite el número de la card, da contexto de tendencia).
  const sparklines = useMemo(() => {
    if (!data) return null
    const unbilled = data.entries.filter(
      (e) =>
        e.status === 'Approved' &&
        e.allocation === 'bill_to_client' &&
        !invoiceByEntryId.has(String(e.id)),
    )
    return {
      pendingHours: last7DaysSeries(unbilled, 'date', 'hours'),
      invoicesThisMonth: last7DaysSeries(data.invoices, 'invoiceDate'),
      collectionsPending: last7DaysSeries(data.collections, 'collectionDate'),
      paymentsDueThisWeek: last7DaysSeries(data.payments, 'paymentDate'),
    }
  }, [data, invoiceByEntryId])

  const billingDist = useMemo(() => {
    if (!data) return []
    const sums = { Pending: 0, Invoiced: 0, Collected: 0, Paid: 0 }
    for (const e of data.entries) {
      const inv = invoiceByEntryId.get(String(e.id))
      // Facturada → cuenta bajo el estado de su factura (una vez emitida, la factura
      // es la fuente de verdad). Sin factura → sólo entra como "Pending" si es
      // facturable al cliente (Approved + bill_to_client), igual que Billing.
      if (inv) sums[inv.status] = (sums[inv.status] || 0) + e.hours
      else if (e.status === 'Approved' && e.allocation === 'bill_to_client') sums.Pending += e.hours
    }
    return Object.entries(sums)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({
        key: name,
        name,
        value: Number(value.toFixed(1)),
        color: STATUS_COLORS[name] ?? '#6b7280',
      }))
  }, [data, invoiceByEntryId])

  // Mismas horas que el donut de billing, pero repartidas por allocation en vez de
  // por estado de factura. Las categorías conocidas (null + los 4 valores del CHECK
  // 0034) se muestran en orden fijo; si apareciera una allocation fuera de ese set
  // (p. ej. si el CHECK se ampliara) se agrega al final en vez de descartar sus horas
  // en silencio. El color sale de la KEY estable, no del label visible.
  const allocationDist = useMemo(() => {
    if (!data) return []
    const sums = new Map()
    for (const e of data.entries) {
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
  }, [data])

  // Ambos donuts reparten EXACTAMENTE las mismas entries (mismo data.entries,
  // misma suma de e.hours), solo que particionadas distinto (por estado de factura
  // vs por allocation). El total del centro tiene que ser el mismo en los dos, así
  // que se calcula UNA vez sobre las horas crudas y se redondea una sola vez.
  //
  // Ojo: NO se suma billingDist/allocationDist, porque esos buckets ya vienen
  // redondeados a 1 decimal y, al redondear por-bucket sobre particiones distintas,
  // las dos sumas pueden diferir en 0.1 h (p. ej. dos entries de 0.25 h: juntas en un
  // bucket dan 0.5; separadas en dos dan 0.3 + 0.3 = 0.6). Usar el total crudo evita
  // ese drift entre los dos centros. Como contrapartida, en esos casos límite el
  // centro puede diferir en 0.1 de la suma visible de su propia leyenda —el
  // compromiso habitual de redondear las partes y el total por separado.
  //
  // Memoizado sobre [data] igual que billingDist/allocationDist (evita re-sumar
  // todas las entries en cada render). Suma e.hours crudo, igual que el resto del
  // componente (billingDist/allocationDist/kpis): confía en el tipo number, sin
  // guards extra que solo cubrirían este consumidor y no los otros tres.
  const totalHours = useMemo(
    () => (data ? data.entries.reduce((sum, e) => sum + e.hours, 0) : 0),
    [data],
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
        <p className="masthead__sub">
          Operations overview. Click any KPI to navigate to that section.
        </p>
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
                    <Sparkline values={sparklines.pendingHours} />
                  </div>
                  <span className="dash-kpi__label">Pending Hours</span>
                  <span className="dash-kpi__value">
                    {kpis.pendingHours.toFixed(1)}
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
            <HoursDonut
              icon={<TrendingUp size={14} />}
              title="Billing Status Distribution"
              data={billingDist}
              total={totalHours}
            />
            <HoursDonut
              icon={<TrendingUp size={14} />}
              title="Allocation Hours Distribution"
              data={allocationDist}
              total={totalHours}
            />
          </div>

          {/* Contracts + Supplier Contracts en dos columnas, para equilibrar el
              ancho debajo de los donuts en vez de dejar la derecha vacía. */}
          <div className="dash-secondary">
            <ContractsExpiringWidget limit={5} />
            <SupplierContractsWidget />
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
