import { useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, BellRing, Download } from 'lucide-react'
import { paymentAlertLevel } from '../lib/paymentsData'
import { pendingToPayByContractor, invoicelessPaidRows } from '../lib/paymentsGrouping'
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

// Estados de factura PAGABLES al contractor. El flujo es Billing → Payments (sin
// paso de Collections): una factura emitida (Invoiced) se paga directo y al pagarla
// pasa a Paid. 'Collected' quedó fuera del flujo: no se lista acá (su vencimiento
// dependía de la fecha de cobro, que ya no se computa; el edge payment-alerts y el
// frontend calculan todo desde la fecha de factura). Una sola fuente para el
// listado, KPIs, filtros, resaltado y el botón de pago — así no se desincronizan.
const PAYABLE_STATUSES = ['Invoiced']
const isPayable = (status) => PAYABLE_STATUSES.includes(status)

// Allocations que se pagan al contractor SIN factura al cliente (invoice-less):
// overage y sp_internal. Mismo mecanismo de pago; sólo cambia la etiqueta. `low`
// va en el copy en minúscula ("Register overage payment"), `cap` como título de
// bloque/toast ("SP internal paid").
const PAY_LABELS = {
  overage: { low: 'overage', cap: 'Overage' },
  sp_internal: { low: 'SP internal', cap: 'SP internal' },
}

export function PaymentsPage() {
  const { user, profile, can } = useOutletContext()
  const [invoices, setInvoices] = useState([])
  const [payments, setPayments] = useState([])
  const [alertSettings, setAlertSettings] = useState(null)
  const [status, setStatus] = useState('loading')
  const [showPaid, setShowPaid] = useState(false)
  const [alertFilter, setAlertFilter] = useState(null) // null|'overdue'|'dueThisWeek'
  const [modalInvoice, setModalInvoice] = useState(null)
  // Contractor cuyo pago invoice-less (overage o sp_internal) se está por
  // registrar (null = modal cerrado). Lleva su `allocation` para el copy y el
  // audit; el mecanismo de pago es idéntico para ambos.
  const [payTarget, setPayTarget] = useState(null)
  // Horas seleccionadas para pagar (D6): por defecto todas las del contractor;
  // el usuario puede destildar para pagar sólo algunas.
  const [paySelectedIds, setPaySelectedIds] = useState(() => new Set())
  const [entries, setEntries] = useState([])
  const [toast, setToast] = useState(null)

  function load() {
    setStatus('loading')
    Promise.all([
      api.invoices.list(),
      api.payments.list(),
      api.payments.getAlertSettings(),
      api.timeEntries.list(),
    ])
      .then(([inv, pay, settings, entryRows]) => {
        setInvoices(inv)
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

  const paymentByInvoice = useMemo(() => {
    const map = new Map()
    for (const p of payments) if (!map.has(p.invoiceId)) map.set(p.invoiceId, p)
    return map
  }, [payments])

  // Horas invoice-less pendientes de pago, por contractor. Overage y sp_internal
  // se le pagan directo al contractor sin factura al cliente (misma lógica; ver
  // pendingToPayByContractor). sp_internal se ruteó a Payments igual que overage:
  // saltea Billing porque no se factura al cliente, pero es un pago a alguien.
  const overagePending = useMemo(
    () => pendingToPayByContractor(entries, payments, invoices, 'overage'),
    [entries, payments, invoices],
  )
  const spInternalPending = useMemo(
    () => pendingToPayByContractor(entries, payments, invoices, 'sp_internal'),
    [entries, payments, invoices],
  )

  // Pagos invoice-less YA hechos (read-only), separados por allocation para
  // dejar rastro auditable de qué se pagó por qué (si no, desaparecerían de la
  // pantalla al salir del pendiente). Ver invoicelessPaidRows.
  const { overage: overagePaid, spInternal: spInternalPaid } = useMemo(
    () => invoicelessPaidRows(payments, entries),
    [payments, entries],
  )

  const warningBefore = alertSettings?.warningDaysBeforeDue ?? 3
  const ALERT_RANK = { overdue: 0, warning: 1, on_time: 2 }

  const allRows = useMemo(
    () =>
      invoices
        // Flujo Billing → Payments (sin Collections): una factura emitida en Billing
        // (Invoiced) es pagable directo. Se listan las pagables y las Paid con el
        // toggle. Ver createPayment / migración 0036.
        .filter((inv) => isPayable(inv.status) || (showPaid && inv.status === 'Paid'))
        .map((inv) => {
          // Vencimiento del pago al contractor: el plazo (paymentTermsDays) corre
          // desde la FECHA DE FACTURA (ya no hay paso de cobro). Aplica a las
          // pagables (no Paid) que tengan fecha de factura; el guard evita
          // addDaysISO sobre null si faltara.
          const dueBase = inv.status !== 'Paid' ? inv.invoiceDate ?? null : null
          const dueDate = dueBase ? addDaysISO(dueBase, inv.paymentTermsDays ?? 30) : null
          const daysUntilDue = dueDate ? daysUntil(dueDate) : null
          const alertLevel =
            inv.status === 'Paid' || !dueDate
              ? 'on_time'
              : paymentAlertLevel(daysUntilDue, warningBefore)
          return {
            inv,
            dueDate,
            daysUntilDue,
            alertLevel,
            payment: paymentByInvoice.get(inv.id) ?? null,
          }
        }),
    [invoices, showPaid, paymentByInvoice, warningBefore],
  )

  // KPIs sobre las facturas pendientes de pago (pagables; ver allRows / isPayable).
  const kpis = useMemo(() => {
    let overdue = 0
    let dueThisWeek = 0
    let totalDue = 0
    for (const r of allRows) {
      if (!isPayable(r.inv.status)) continue
      totalDue += r.inv.totalAmount
      // Vencido / esta-semana sólo cuentan las que tienen deadline (fecha de
      // factura + plazo); una sin fecha de factura no "vence".
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

  // Pago invoice-less (overage o sp_internal): cubre las horas SELECCIONADAS del
  // contractor (D6 — por defecto todas, pero se pueden pagar sólo algunas). No
  // hay factura al cliente; las horas cubiertas quedan congeladas y salen del
  // pendiente. El allocation sólo cambia el copy/audit — el pago es idéntico
  // (createOverage inserta un pago sin invoice con entryIds+userName). payload
  // trae también la moneda (D7).
  async function handleRegisterPayment(payload) {
    const { allocation, user: contractor } = payTarget
    const selected = payTarget.entries.filter((e) => paySelectedIds.has(String(e.id)))
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
        amountPaid: payload.amountPaid,
        currency: payload.currency,
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
      // Coalesce a '' (no null): una celda vacía en el export es más limpia que un
      // null literal cuando la factura no tiene fecha de vencimiento.
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

  // Bloque "a pagar" de un allocation invoice-less (overage / sp_internal): horas
  // aprobadas y sin pagar por contractor. Overage y sp_internal comparten diseño;
  // sólo cambian la etiqueta y el allocation que dispara el modal de pago.
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
                {pending.map((group) => (
                  <tr key={group.user || '—'}>
                    <td className="cell-strong">{group.user || '—'}</td>
                    <td className="col-num cell-mono">{formatHours(group.hours)} h</td>
                    <td>
                      {can('payments.create') && (
                        <button
                          type="button"
                          className="btn btn--pay btn--row"
                          onClick={() => {
                            setPayTarget({ ...group, allocation })
                            // Arranca con todas las horas seleccionadas (D6).
                            setPaySelectedIds(new Set(group.entryIds.map(String)))
                          }}
                        >
                          Pay {label.low}
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
    )
  }

  // Bloque "ya pagado" (read-only) de un allocation invoice-less: deja rastro
  // auditable de lo pagado, que si no desaparecería al salir del pendiente.
  function renderPaid(allocation, rows) {
    if (rows.length === 0) return null
    const label = PAY_LABELS[allocation]
    return (
      <section className="pay-overage">
        <div className="toolbar">
          <span className="toolbar__count">
            {label.cap} paid · {rows.length} {rows.length === 1 ? 'payment' : 'payments'}
          </span>
        </div>
        <div className="table-wrap table-wrap--scroll">
          <table className="table proj-table">
            <thead>
              <tr>
                <th scope="col">Contractor</th>
                <th scope="col" className="col-num">Hours</th>
                <th scope="col" className="col-num">Amount</th>
                <th scope="col">Paid on</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="row-static">
                  <td className="cell-strong">{row.user || '—'}</td>
                  <td className="col-num cell-mono">
                    {formatHours(row.hours)} h
                    <span className="cell-soft"> · {row.entryCount}</span>
                  </td>
                  <td className="col-num cell-mono">
                    {getCurrencySymbol(row.currency)}
                    {fmtAmount(row.amountPaid)} {row.currency}
                  </td>
                  <td className="cell-mono">{formatDate(row.paymentDate)}</td>
                </tr>
              ))}
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
        <p className="masthead__sub">
          Contractor payment for invoices ready to pay — issued in Billing
          (Invoiced); once paid, they move to Paid. Overage and SP internal hours
          are paid here too — per contractor, without an invoice — and freeze once
          paid.
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

          {/* Horas invoice-less a pagar (sin factura al cliente): overage y
              sp_internal, cada una en su bloque. sp_internal saltea Billing pero
              es un pago a alguien, por eso vive acá igual que overage. */}
          {renderToPay('overage', overagePending)}
          {renderToPay('sp_internal', spInternalPending)}

          {/* Pagos invoice-less ya hechos (read-only), separados por allocation. */}
          {renderPaid('overage', overagePaid)}
          {renderPaid('sp_internal', spInternalPaid)}
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
        {payTarget &&
          (() => {
            const label = PAY_LABELS[payTarget.allocation]
            const selected = payTarget.entries.filter((e) =>
              paySelectedIds.has(String(e.id)),
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
                currencyEditable
                extraValid={selected.length > 0}
                summaryName={payTarget.user}
                summaryMeta={`${label.cap} · ${selected.length} of ${payTarget.entries.length} ${
                  payTarget.entries.length === 1 ? 'entry' : 'entries'
                }`}
                summaryFigure={`${formatHours(selHours)} h`}
                summaryFigureLabel={`${label.cap} hours (selected)`}
                defaultAmount=""
                extraContent={
                  <div className="overage-picker">
                    <span className="overage-picker__title">Hours to pay</span>
                    <ul className="overage-picker__list">
                      {payTarget.entries.map((e) => (
                        <li key={e.id}>
                          <label className="overage-picker__row">
                            <input
                              type="checkbox"
                              checked={paySelectedIds.has(String(e.id))}
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
