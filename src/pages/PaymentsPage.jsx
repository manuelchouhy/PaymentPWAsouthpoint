import { useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, BellRing, Download } from 'lucide-react'
import { paymentAlertLevel } from '../lib/paymentsData'
import { api } from '../lib/api'
import { downloadPaymentReceipt } from '../lib/paymentReceipt'
import { formatDate } from '../lib/format'
import { BillingBadge } from '../components/BillingBadge'
import { RegisterPaymentModal } from '../components/RegisterPaymentModal'
import { Toast } from '../components/Toast'
import { ExportDropdown } from '../components/ExportDropdown'
import { exportGrid } from '../lib/exportGrid'
import { getCurrencySymbol } from '../lib/currenciesData'

function fmtAmount(value) {
  return Number(value || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
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

export function PaymentsPage() {
  const { user, profile, can } = useOutletContext()
  const [invoices, setInvoices] = useState([])
  const [collections, setCollections] = useState([])
  const [payments, setPayments] = useState([])
  const [alertSettings, setAlertSettings] = useState(null)
  const [status, setStatus] = useState('loading')
  const [showPaid, setShowPaid] = useState(false)
  const [alertFilter, setAlertFilter] = useState(null) // null|'overdue'|'dueThisWeek'
  const [modalInvoice, setModalInvoice] = useState(null)
  const [toast, setToast] = useState(null)

  function load() {
    setStatus('loading')
    Promise.all([api.invoices.list(), api.collections.list(), api.payments.list(), api.payments.getAlertSettings()])
      .then(([inv, col, pay, settings]) => {
        setInvoices(inv)
        setCollections(col)
        setPayments(pay)
        setAlertSettings(settings)
        setStatus('ready')
      })
      .catch((error) => {
        console.error('No se pudo cargar Payments:', error)
        setStatus('error')
      })
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const collectionDateByInvoice = useMemo(() => {
    const map = new Map()
    for (const c of collections) {
      const prev = map.get(c.invoiceId)
      if (!prev || c.collectionDate > prev) map.set(c.invoiceId, c.collectionDate)
    }
    return map
  }, [collections])

  const paymentByInvoice = useMemo(() => {
    const map = new Map()
    for (const p of payments) if (!map.has(p.invoiceId)) map.set(p.invoiceId, p)
    return map
  }, [payments])

  const warningBefore = alertSettings?.warningDaysBeforeDue ?? 3
  const ALERT_RANK = { overdue: 0, warning: 1, on_time: 2 }

  const allRows = useMemo(
    () =>
      invoices
        .filter((inv) => inv.status === 'Collected' || (showPaid && inv.status === 'Paid'))
        .map((inv) => {
          const collectionDate = collectionDateByInvoice.get(inv.id) ?? inv.invoiceDate
          const dueDate = addDaysISO(collectionDate, inv.paymentTermsDays ?? 30)
          const daysUntilDue = daysUntil(dueDate)
          const alertLevel =
            inv.status === 'Paid'
              ? 'on_time'
              : paymentAlertLevel(daysUntilDue, warningBefore)
          return {
            inv,
            collectionDate,
            dueDate,
            daysUntilDue,
            alertLevel,
            payment: paymentByInvoice.get(inv.id) ?? null,
          }
        }),
    [invoices, showPaid, collectionDateByInvoice, paymentByInvoice, warningBefore],
  )

  // KPIs sobre las facturas pendientes de pago (Collected).
  const kpis = useMemo(() => {
    let overdue = 0
    let dueThisWeek = 0
    let totalDue = 0
    for (const r of allRows) {
      if (r.inv.status !== 'Collected') continue
      totalDue += r.inv.totalAmount
      if (r.alertLevel === 'overdue') overdue += 1
      if (r.daysUntilDue >= 0 && r.daysUntilDue <= 7) dueThisWeek += 1
    }
    return { overdue, dueThisWeek, totalDue }
  }, [allRows])

  const rows = useMemo(() => {
    const filtered = allRows.filter((r) => {
      if (alertFilter === 'overdue') return r.alertLevel === 'overdue'
      if (alertFilter === 'dueThisWeek')
        return r.inv.status === 'Collected' && r.daysUntilDue >= 0 && r.daysUntilDue <= 7
      return true
    })
    // Orden: vencidos arriba, después warning, después por fecha de vencimiento.
    return filtered.sort(
      (a, b) =>
        (ALERT_RANK[a.alertLevel] - ALERT_RANK[b.alertLevel]) ||
        a.dueDate.localeCompare(b.dueDate),
    )
  }, [allRows, alertFilter])

  async function handleRegister(payload) {
    const { inv } = modalInvoice
    const { payment } = await api.payments.create(inv, payload, user?.email ?? null)
    setPayments((prev) => [payment, ...prev])
    setInvoices((prev) => prev.map((i) => (i.id === inv.id ? { ...i, status: 'Paid' } : i)))
    api.audit.log({ actorEmail: user?.email, actorRole: profile?.roles?.[0] ?? null, action: 'payment.create', resourceType: 'payment', resourceId: payment.id, after: { invoiceId: inv.id, invoiceNumber: inv.supplierInvoiceNumber, amountPaid: payload.amountPaid, paymentDate: payload.paymentDate } })
    setModalInvoice(null)
    setToast({
      id: Date.now(),
      message: `${inv.supplierInvoiceNumber} pagada a ${inv.userName} → Paid`,
    })
  }

  function handleDownload(row) {
    const payment = row.payment ?? paymentByInvoice.get(row.inv.id)
    if (!payment) {
      setToast({ id: Date.now(), tone: 'error', message: 'Payment record not found for this invoice.' })
      return
    }
    downloadPaymentReceipt({ invoice: row.inv, payment, generatedBy: user?.email ?? null })
  }

  function handleExport(format) {
    const cols = [
      { header: 'Contractor', key: 'contractor' },
      { header: 'Invoice #', key: 'invoiceNumber' },
      { header: 'Currency', key: 'currency' },
      { header: 'Amount Due', key: 'totalAmount' },
      { header: 'Collection Date', key: 'collectionDate' },
      { header: 'Payment Due', key: 'dueDate' },
      { header: 'Days Until Due', key: 'daysUntilDue' },
      { header: 'Alert', key: 'alertLevel' },
      { header: 'Status', key: 'status' },
      { header: 'Payment Date', key: 'paymentDate' },
      { header: 'Transfer Ref', key: 'transferReference' },
      { header: 'Exchange Rate', key: 'exchangeRate' },
    ]
    const exportRows = rows.map((r) => ({
      contractor: r.inv.userName,
      invoiceNumber: r.inv.supplierInvoiceNumber,
      currency: r.inv.currency ?? 'USD',
      totalAmount: r.inv.totalAmount,
      collectionDate: r.collectionDate,
      dueDate: r.dueDate,
      daysUntilDue: r.daysUntilDue,
      alertLevel: r.alertLevel,
      status: r.inv.status,
      paymentDate: r.payment?.paymentDate ?? '',
      transferReference: r.payment?.transferReference ?? '',
      exchangeRate: r.payment?.exchangeRate ?? '',
    }))
    exportGrid({ rows: exportRows, columns: cols, title: 'Payments', gridName: 'payments', format, generatedBy: user?.email ?? '' })
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
        <p className="masthead__sub">
          Contractor payment for already-collected invoices (Collected). Only
          invoices in Collected status can be paid; once paid, they move to Paid.
        </p>
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
                <span className="proj-kpi__count">${fmtAmount(kpis.totalDue)}</span>
                <span className="proj-kpi__label">Total amount due</span>
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
                    <th scope="col">Invoice #</th>
                    <th scope="col" className="col-num">Amount Due</th>
                    <th scope="col">Collection Date</th>
                    <th scope="col">Payment Due</th>
                    <th scope="col" className="col-num">Days Until Due</th>
                    <th scope="col">Alert</th>
                    <th scope="col">Status</th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, index) => {
                    const overdue = r.inv.status === 'Collected' && r.alertLevel === 'overdue'
                    const warning = r.inv.status === 'Collected' && r.alertLevel === 'warning'
                    const rowClass = overdue
                      ? 'row--overdue-high'
                      : warning
                        ? 'row--overdue-mid'
                        : ''
                    return (
                      <motion.tr
                        key={r.inv.id}
                        className={rowClass}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: Math.min(index * 0.02, 0.3) }}
                      >
                        <td>{r.inv.userName}</td>
                        <td className="cell-mono">{r.inv.supplierInvoiceNumber}</td>
                        <td className="col-num cell-mono">{getCurrencySymbol(r.inv.currency)}{fmtAmount(r.inv.totalAmount)}</td>
                        <td className="cell-mono">{formatDate(r.collectionDate)}</td>
                        <td className="cell-mono">{formatDate(r.dueDate)}</td>
                        <td className={`col-num cell-mono${overdue ? ' proj-days--overdue' : ''}`}>
                          {r.inv.status === 'Paid' ? '—' : r.daysUntilDue}
                        </td>
                        <td>
                          {overdue ? (
                            <span className="badge badge--expired">Overdue</span>
                          ) : warning ? (
                            <span className="badge badge--critical">Warning</span>
                          ) : (
                            <span className="cell-pop-empty">—</span>
                          )}
                        </td>
                        <td><BillingBadge status={r.inv.status} /></td>
                        <td>
                          {r.inv.status === 'Collected' && can('payments.create') ? (
                            <button
                              type="button"
                              className="btn btn--pay btn--row"
                              onClick={() => setModalInvoice(r)}
                            >
                              Register Payment
                            </button>
                          ) : r.inv.status !== 'Collected' ? (
                            <button
                              type="button"
                              className="btn btn--ghost btn--row"
                              onClick={() => handleDownload(r)}
                            >
                              <Download size={14} aria-hidden="true" />
                              Receipt
                            </button>
                          ) : null}
                        </td>
                      </motion.tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      )}

      <AnimatePresence>
        {modalInvoice && (
          <RegisterPaymentModal
            key={`pay-${modalInvoice.inv.id}`}
            invoice={modalInvoice.inv}
            currency={modalInvoice.inv.currency ?? 'USD'}
            onClose={() => setModalInvoice(null)}
            onConfirm={handleRegister}
          />
        )}
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
