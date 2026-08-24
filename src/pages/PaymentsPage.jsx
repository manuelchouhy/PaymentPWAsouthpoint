import { useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, BellRing, Download } from 'lucide-react'
import { paymentAlertLevel, paidEntryIdsFrom } from '../lib/paymentsData'
import { api } from '../lib/api'
import { downloadPaymentReceipt } from '../lib/paymentReceipt'
import { formatDate, formatHours } from '../lib/format'
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

// Estados de factura PAGABLES al contractor (flujo Billing → Payments, sin
// Collections): emitida (Invoiced) o cobrada (Collected). Una sola fuente para el
// listado, KPIs, filtros, resaltado y el botón de pago — así no se desincronizan.
const PAYABLE_STATUSES = ['Invoiced', 'Collected']
const isPayable = (status) => PAYABLE_STATUSES.includes(status)

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
  // Contractor cuyo overage pendiente se está por pagar (null = modal cerrado).
  const [overageTarget, setOverageTarget] = useState(null)
  // Horas de overage seleccionadas para pagar (D6): por defecto todas las del
  // contractor; el usuario puede destildar para pagar sólo algunas.
  const [overageSelectedIds, setOverageSelectedIds] = useState(() => new Set())
  const [entries, setEntries] = useState([])
  const [toast, setToast] = useState(null)

  function load() {
    setStatus('loading')
    Promise.all([
      api.invoices.list(),
      api.collections.list(),
      api.payments.list(),
      api.payments.getAlertSettings(),
      api.timeEntries.list(),
    ])
      .then(([inv, col, pay, settings, entryRows]) => {
        setInvoices(inv)
        setCollections(col)
        setPayments(pay)
        setAlertSettings(settings)
        setEntries(entryRows)
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

  // Overage pendiente de pago, agrupado por contractor: horas allocation='overage',
  // aprobadas y NO cubiertas todavía por ningún pago (paidEntryIdsFrom). El overage
  // se le paga al contractor sin pasar por factura al cliente.
  const overagePending = useMemo(() => {
    const paid = paidEntryIdsFrom(payments)
    // Horas ya en una factura de proveedor: se pagan por esa factura, NO por
    // overage — excluirlas evita pagar dos veces la misma hora.
    const invoiced = new Set(invoices.flatMap((inv) => (inv.entryIds ?? []).map(String)))
    const byUser = new Map()
    for (const e of entries) {
      if (e.allocation !== 'overage' || e.status !== 'Approved') continue
      if (paid.has(String(e.id)) || invoiced.has(String(e.id))) continue
      const group = byUser.get(e.user) ?? { user: e.user, hours: 0, entryIds: [], entries: [] }
      group.hours += Number(e.hours) || 0
      group.entryIds.push(e.id)
      // Desglose por hora, para poder pagar sólo algunas (D6).
      group.entries.push({
        id: e.id,
        hours: Number(e.hours) || 0,
        project: e.project,
        task: e.task,
        date: e.date,
      })
      byUser.set(e.user, group)
    }
    return [...byUser.values()].sort(
      (a, b) => b.hours - a.hours || (a.user || '').localeCompare(b.user || '', 'es'),
    )
  }, [entries, payments, invoices])

  const warningBefore = alertSettings?.warningDaysBeforeDue ?? 3
  const ALERT_RANK = { overdue: 0, warning: 1, on_time: 2 }

  const allRows = useMemo(
    () =>
      invoices
        // Flujo Billing → Payments (Collections no se usa por ahora): una factura
        // emitida en Billing (Invoiced) es pagable directo, sin paso de cobro. Se
        // listan Invoiced y Collected (esta última por datos viejos), y Paid con el
        // toggle. Ver createPayment / migración 0036.
        .filter((inv) => isPayable(inv.status) || (showPaid && inv.status === 'Paid'))
        .map((inv) => {
          // El vencimiento de pago al contractor SÓLO aplica a facturas COBRADAS:
          // el plazo (paymentTermsDays) corre desde el cobro. Una Invoiced es
          // pagable ya, pero sin deadline → sin fecha de vencimiento ni alerta. Así
          // no se rotula la fecha de factura como cobro, no se marca overdue una
          // Invoiced vieja, y no se calcula sobre una fecha nula si falta invoiceDate.
          // Registro de cobro (si existe) — para mostrar la fecha real de cobro.
          const collectionDate = collectionDateByInvoice.get(inv.id) ?? null
          // El vencimiento de pago aplica a las COBRADAS (por status): base = fecha
          // de cobro, o la de factura como fallback si falta el registro (dato
          // incompleto — una Collected debería tener cobro). Una Invoiced es pagable
          // pero sin deadline → sin dueDate. El guard evita addDaysISO sobre null.
          const dueBase =
            inv.status === 'Collected' ? collectionDate ?? inv.invoiceDate ?? null : null
          const dueDate = dueBase ? addDaysISO(dueBase, inv.paymentTermsDays ?? 30) : null
          const daysUntilDue = dueDate ? daysUntil(dueDate) : null
          const alertLevel =
            inv.status === 'Paid' || !dueDate
              ? 'on_time'
              : paymentAlertLevel(daysUntilDue, warningBefore)
          return {
            inv,
            collected: Boolean(collectionDate),
            collectionDate,
            dueDate,
            daysUntilDue,
            alertLevel,
            payment: paymentByInvoice.get(inv.id) ?? null,
          }
        }),
    [invoices, showPaid, collectionDateByInvoice, paymentByInvoice, warningBefore],
  )

  // KPIs sobre las facturas pendientes de pago (Invoiced o Collected — ambas son
  // pagables en el flujo Billing → Payments; ver allRows).
  const kpis = useMemo(() => {
    let overdue = 0
    let dueThisWeek = 0
    let totalDue = 0
    for (const r of allRows) {
      if (!isPayable(r.inv.status)) continue
      totalDue += r.inv.totalAmount
      // Vencido / esta-semana sólo cuentan las que tienen deadline (cobradas);
      // una Invoiced es pagable pero no "vence".
      if (r.dueDate) {
        if (r.alertLevel === 'overdue') overdue += 1
        if (r.daysUntilDue >= 0 && r.daysUntilDue <= 7) dueThisWeek += 1
      }
    }
    return { overdue, dueThisWeek, totalDue }
  }, [allRows])

  const rows = useMemo(() => {
    const filtered = allRows.filter((r) => {
      if (alertFilter === 'overdue') return r.alertLevel === 'overdue'
      if (alertFilter === 'dueThisWeek')
        // r.dueDate guard: sin él, daysUntilDue null pasaría (null>=0 es true en JS).
        return Boolean(r.dueDate) && r.daysUntilDue >= 0 && r.daysUntilDue <= 7
      return true
    })
    // Orden: vencidos arriba, después warning, después por fecha de vencimiento.
    // dueDate puede ser null (Invoiced/Paid sin deadline): se ordenan al final
    // (coalesce a una fecha alta) para no romper el localeCompare.
    return filtered.sort(
      (a, b) =>
        ALERT_RANK[a.alertLevel] - ALERT_RANK[b.alertLevel] ||
        (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31'),
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

  // Pago de overage: cubre las horas SELECCIONADAS del contractor (D6 — por defecto
  // todas, pero se pueden pagar sólo algunas). No hay factura; las horas cubiertas
  // quedan congeladas y salen del pendiente. payload trae también la moneda (D7).
  async function handleRegisterOverage(payload) {
    const contractor = overageTarget.user
    const selected = overageTarget.entries.filter((e) => overageSelectedIds.has(String(e.id)))
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
        overage: true,
        userName: contractor,
        entryCount: entryIds.length,
        amountPaid: payload.amountPaid,
        currency: payload.currency,
        paymentDate: payload.paymentDate,
      },
    })
    setPayments((prev) => [payment, ...prev])
    setOverageTarget(null)
    setToast({ id: Date.now(), message: `Overage paid to ${contractor} — ${formatHours(hours)} h (frozen)` })
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
      // Coalesce a '' (no null): una Invoiced no tiene cobro ni vencimiento, y una
      // celda vacía en el export es más limpia que un null literal.
      collectionDate: r.collectionDate ?? '',
      dueDate: r.dueDate ?? '',
      daysUntilDue: r.daysUntilDue ?? '',
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
          Contractor payment for invoices ready to pay — issued in Billing
          (Invoiced) or Collected: once paid, they move to Paid. Overage hours are
          paid here too — per contractor, without an invoice — and freeze once paid.
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
                    // Pagable = emitida o cobrada (flujo Billing → Payments). El
                    // resaltado de vencimiento, el badge de alerta y el botón de
                    // pago aplican a ambas; sólo Paid queda fuera.
                    const payable = isPayable(r.inv.status)
                    const overdue = payable && r.alertLevel === 'overdue'
                    const warning = payable && r.alertLevel === 'warning'
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
                        <td className="cell-mono">
                          {r.collected ? formatDate(r.collectionDate) : '—'}
                        </td>
                        <td className="cell-mono">{r.dueDate ? formatDate(r.dueDate) : '—'}</td>
                        <td className={`col-num cell-mono${overdue ? ' proj-days--overdue' : ''}`}>
                          {r.daysUntilDue == null ? '—' : r.daysUntilDue}
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
                          {payable && can('payments.create') ? (
                            <button
                              type="button"
                              className="btn btn--pay btn--row"
                              onClick={() => setModalInvoice(r)}
                            >
                              Register Payment
                            </button>
                          ) : r.inv.status === 'Paid' ? (
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

          {/* Overage a pagar: horas de overage aprobadas y sin pagar, por
              contractor. Se pagan sin factura al cliente; al pagarlas quedan
              congeladas y salen del pendiente. */}
          <section className="pay-overage">
            <div className="toolbar">
              <span className="toolbar__count">
                Overage to pay · {overagePending.length}{' '}
                {overagePending.length === 1 ? 'contractor' : 'contractors'}
              </span>
            </div>
            {overagePending.length === 0 ? (
              <div className="empty">No pending overage hours to pay.</div>
            ) : (
              <div className="table-wrap table-wrap--scroll">
                <table className="table proj-table">
                  <thead>
                    <tr>
                      <th scope="col">Contractor</th>
                      <th scope="col" className="col-num">Overage hours</th>
                      <th scope="col" style={{ width: 160 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {overagePending.map((group) => (
                      <tr key={group.user || '—'}>
                        <td className="cell-strong">{group.user || '—'}</td>
                        <td className="col-num cell-mono">{formatHours(group.hours)} h</td>
                        <td>
                          {can('payments.create') && (
                            <button
                              type="button"
                              className="btn btn--pay btn--row"
                              onClick={() => {
                                setOverageTarget(group)
                                // Arranca con todas las horas seleccionadas (D6).
                                setOverageSelectedIds(new Set(group.entryIds.map(String)))
                              }}
                            >
                              Pay overage
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
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
        {overageTarget &&
          (() => {
            const selected = overageTarget.entries.filter((e) =>
              overageSelectedIds.has(String(e.id)),
            )
            const selHours = selected.reduce((sum, e) => sum + e.hours, 0)
            const toggle = (id) =>
              setOverageSelectedIds((prev) => {
                const next = new Set(prev)
                const k = String(id)
                if (next.has(k)) next.delete(k)
                else next.add(k)
                return next
              })
            return (
              <RegisterPaymentModal
                key={`overage-${overageTarget.user}`}
                title="Register overage payment"
                submitLabel="Register overage payment"
                currencyEditable
                extraValid={selected.length > 0}
                summaryName={overageTarget.user}
                summaryMeta={`Overage · ${selected.length} of ${overageTarget.entries.length} ${
                  overageTarget.entries.length === 1 ? 'entry' : 'entries'
                }`}
                summaryFigure={`${formatHours(selHours)} h`}
                summaryFigureLabel="Overage hours (selected)"
                defaultAmount=""
                extraContent={
                  <div className="overage-picker">
                    <span className="overage-picker__title">Hours to pay</span>
                    <ul className="overage-picker__list">
                      {overageTarget.entries.map((e) => (
                        <li key={e.id}>
                          <label className="overage-picker__row">
                            <input
                              type="checkbox"
                              checked={overageSelectedIds.has(String(e.id))}
                              onChange={() => toggle(e.id)}
                            />
                            <span className="overage-picker__desc">
                              {e.project || '—'}
                              {e.task ? ` · ${e.task}` : ''}
                              {e.date ? ` · ${formatDate(e.date)}` : ''}
                            </span>
                            <span className="overage-picker__hours">{formatHours(e.hours)} h</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                    {selected.length === 0 && (
                      <span className="field__error">Select at least one hour to pay.</span>
                    )}
                  </div>
                }
                footerNote={
                  <>
                    Registers a contractor payment for the selected overage hours (no
                    invoice). They’ll be frozen and drop off the pending list.
                  </>
                }
                onClose={() => setOverageTarget(null)}
                onConfirm={handleRegisterOverage}
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
