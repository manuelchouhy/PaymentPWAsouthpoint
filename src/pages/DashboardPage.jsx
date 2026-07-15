import { useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  CreditCard,
  FileText,
  Plus,
  Receipt,
  TrendingUp,
} from 'lucide-react'
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { api } from '../lib/api'
import { ContractsExpiringWidget } from '../components/dashboard/ContractsExpiringWidget'
import { SupplierContractsWidget } from '../components/dashboard/SupplierContractsWidget'

const STATUS_COLORS = {
  Pending: '#52525B',
  Invoiced: '#F59E0B',
  Collected: '#00BFD4',
  Paid: '#10B981',
}

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

export function DashboardPage() {
  const { can } = useOutletContext()
  const [data, setData] = useState(null)
  const [loadStatus, setLoadStatus] = useState('loading')

  useEffect(() => {
    let cancelled = false
    setLoadStatus('loading')
    Promise.all([api.timeEntries.list(), api.invoices.list(), api.collections.list()])
      .then(([entries, invoices, collections]) => {
        if (cancelled) return
        setData({ entries, invoices, collections })
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

    const pendingHours = data.entries
      .filter((e) => !invoiceByEntryId.has(String(e.id)))
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

  const billingDist = useMemo(() => {
    if (!data) return []
    const sums = { Pending: 0, Invoiced: 0, Collected: 0, Paid: 0 }
    for (const e of data.entries) {
      const inv = invoiceByEntryId.get(String(e.id))
      const st = inv ? inv.status : 'Pending'
      sums[st] = (sums[st] || 0) + e.hours
    }
    return Object.entries(sums)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name, value: Number(value.toFixed(1)) }))
  }, [data, invoiceByEntryId])

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
          <span className="masthead__kicker">Overview · {monthLabel}</span>
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
                <Link to="/time-entries" className="dash-kpi">
                  <span className="dash-kpi__label">Pending Hours</span>
                  <span className="dash-kpi__value">
                    {kpis.pendingHours.toFixed(1)}
                    <span className="dash-kpi__unit"> h</span>
                  </span>
                  <span className="dash-kpi__hint">unbilled entries</span>
                </Link>
                <Link to="/time-entries" className="dash-kpi">
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
              <span className="dash-kpi__label">Collections Pending</span>
              <span className="dash-kpi__value">{kpis.collectionsPending}</span>
              <span className="dash-kpi__hint">invoiced, not yet collected</span>
            </Link>
            <Link
              to="/payments"
              className={`dash-kpi${kpis.paymentsDueThisWeek > 0 ? ' dash-kpi--urgent' : ''}`}
            >
              <span className="dash-kpi__label">Payments Due This Week</span>
              <span className="dash-kpi__value">{kpis.paymentsDueThisWeek}</span>
              <span className="dash-kpi__hint">next 7 days</span>
            </Link>
          </div>

          {/* Billing Status Chart + Contracts Expiring */}
          <div className="dash-main">
            <div className="dash-widget" style={{ maxWidth: 'none' }}>
              <div className="dash-widget__head">
                <span className="dash-widget__title">
                  <TrendingUp size={14} />
                  Billing Status Distribution
                </span>
              </div>
              {billingDist.length === 0 ? (
                <p className="dash-widget__empty">No hour data available.</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={billingDist}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={88}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {billingDist.map((entry) => (
                        <Cell
                          key={entry.name}
                          fill={STATUS_COLORS[entry.name] ?? '#6b7280'}
                          stroke="transparent"
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value, name) => [`${value} h`, name]}
                      contentStyle={{
                        background: '#1a1a1f',
                        border: '1px solid rgba(255,255,255,.12)',
                        borderRadius: 8,
                        fontSize: 12,
                        color: '#e4e4e7',
                      }}
                    />
                    <Legend
                      iconType="circle"
                      iconSize={9}
                      formatter={(value) => (
                        <span style={{ fontSize: 12, color: '#a0a0ab' }}>{value}</span>
                      )}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            <ContractsExpiringWidget limit={5} />
          </div>

          {/* Supplier Contracts Widget */}
          <div style={{ marginTop: 16 }}>
            <SupplierContractsWidget />
          </div>

          {/* Quick Actions */}
          <div className="dash-actions">
            {can('billing.create') && (
              <Link to="/time-entries" className="dash-action-btn">
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
