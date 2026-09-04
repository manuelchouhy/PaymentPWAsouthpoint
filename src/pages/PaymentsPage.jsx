import { useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, BellRing, Download } from 'lucide-react'
import { paymentAlertLevel } from '../lib/paymentsData'
import {
  pendingToPayByContractor,
  invoicelessPaidRows,
  paidEntryIdsFrom,
} from '../lib/paymentsGrouping'
import { invoiceCompletion } from '../lib/invoiceCompletion'
import { api } from '../lib/api'
import { downloadPaymentReceipt } from '../lib/paymentReceipt'
import { formatDate, formatHours } from '../lib/format'
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
  const [toast, setToast] = useState(null)

  function load() {
    setStatus('loading')
    Promise.all([
      api.invoices.list(),
      api.invoices.listContractors(),
      api.payments.list(),
      api.payments.getAlertSettings(),
      api.timeEntries.list(),
      api.projects.list(),
    ])
      .then(([inv, ic, pay, settings, entryRows, projectRows]) => {
        setInvoices(inv)
        setInvoiceContractors(ic)
        setPayments(pay)
        setAlertSettings(settings)
        setEntries(entryRows)
        setProjects(projectRows)
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

  // Nombre de proyecto → número, para el encabezado de la factura. La factura sólo
  // guarda el nombre; el número vive en el proyecto. Dos proyectos de Zoho homónimos
  // con números distintos → null (se muestra sólo el nombre) en vez del número del
  // primero, que sería engañoso. Mismo criterio de ambigüedad que Billing/Entries.
  const projectNumberByName = useMemo(() => {
    const map = new Map()
    for (const p of projects) {
      if (!p.projectName || !p.projectNumber) continue
      const prior = map.get(p.projectName)
      if (prior === undefined) map.set(p.projectName, p.projectNumber)
      else if (prior !== p.projectNumber) map.set(p.projectName, null)
    }
    return map
  }, [projects])
  const projectNumberFor = (name) => (name ? projectNumberByName.get(name) ?? null : null)

  const warningBefore = alertSettings?.warningDaysBeforeDue ?? 3
  const ALERT_RANK = { overdue: 0, warning: 1, on_time: 2 }

  // Una fila por factura, expandida a sus contractors vía el módulo puro (y testeado)
  // `invoiceCompletion`: deriva paid/paidCount/totalCount/totalHours en horas (una fila
  // pagada por payment_id o por cobertura de entry_ids; una fila sin entry_ids se
  // descarta). Una factura Invoiced con todos sus contractors ya pagos (estado
  // transitorio antes de que la RPC flipee a Paid) no tiene pendientes → se oculta.
  const invoiceRows = useMemo(() => {
    const rows = []
    for (const inv of invoices) {
      if (!(isPayable(inv.status) || (showPaid && inv.status === 'Paid'))) continue
      const completion = invoiceCompletion(contractorsByInvoice.get(inv.id) ?? [], payments)
      const pending = completion.contractors.filter((c) => !c.paid)
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
        contractors: completion.contractors,
        pending,
        paidCount: completion.paidCount,
        totalCount: completion.totalCount,
        totalHours: completion.totalHours,
        dueDate,
        daysUntilDue,
        alertLevel,
      })
    }
    return rows
  }, [invoices, contractorsByInvoice, payments, showPaid, warningBefore])

  // Horas invoice-less pendientes de pago, por contractor (overage / sp_internal).
  const overagePending = useMemo(
    () => pendingToPayByContractor(entries, payments, invoices, 'overage'),
    [entries, payments, invoices],
  )
  const spInternalPending = useMemo(
    () => pendingToPayByContractor(entries, payments, invoices, 'sp_internal'),
    [entries, payments, invoices],
  )

  // Pagos invoice-less YA hechos (read-only), separados por allocation.
  const { overage: overagePaid, spInternal: spInternalPaid } = useMemo(
    () => invoicelessPaidRows(payments, entries),
    [payments, entries],
  )

  // KPIs sobre las facturas pendientes de pago. Total pendiente en HORAS (suma de las
  // horas de los contractors todavía sin pagar en las facturas pagables).
  const kpis = useMemo(() => {
    let overdue = 0
    let dueThisWeek = 0
    let pendingHours = 0
    for (const r of invoiceRows) {
      if (!isPayable(r.inv.status)) continue
      pendingHours += r.contractors.reduce(
        (s, ic) => s + (ic.paid ? 0 : Number(ic.hours) || 0),
        0,
      )
      if (r.dueDate) {
        if (r.alertLevel === 'overdue') overdue += 1
        if (r.daysUntilDue >= 0 && r.daysUntilDue <= 7) dueThisWeek += 1
      }
    }
    return { overdue, dueThisWeek, pendingHours }
  }, [invoiceRows])

  const rows = useMemo(() => {
    const filtered = invoiceRows.filter((r) => {
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
  }, [invoiceRows, alertFilter])

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
    const exportRows = rows.flatMap((r) =>
      r.contractors.map((ic) => ({
        spInvoice: r.inv.spInvoiceNumber ?? '',
        projectNumber: projectNumberFor(r.inv.project) ?? '',
        project: r.inv.project ?? '',
        client: r.inv.client ?? '',
        contractor: ic.contractor,
        supplierInvoice: ic.supplierInvoiceNumber ?? '',
        hours: Number(ic.hours) || 0,
        contractorStatus: ic.paid ? 'Paid' : 'Pending',
        invoiceStatus: r.inv.status,
        dueDate: r.dueDate ?? '',
        paymentDate: ic.paymentDate ?? '',
      })),
    )
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
              {paidRows.map((row) => (
                <tr key={row.id} className="row-static">
                  <td className="cell-strong">{row.user || '—'}</td>
                  <td className="col-num cell-mono">
                    {formatHours(row.hours)} h
                    <span className="cell-soft"> · {row.entryCount}</span>
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
          Pay each contractor of an issued invoice separately — load their supplier
          invoice number and date. The invoice moves to Paid once every contractor is
          paid. Overage and SP internal hours are paid here too — per contractor,
          without an invoice — and freeze once paid. All in hours.
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
                  return (
                    <tbody key={r.inv.id} className="pay-invoice-group">
                      <tr className="pay-invoice-head">
                        <td colSpan={5}>
                          <div className="pay-invoice-head__row">
                            <span className="cell-strong cell-mono">
                              {r.inv.spInvoiceNumber ?? '—'}
                            </span>
                            <span className="cell-soft">
                              {projectNumberFor(r.inv.project) && (
                                <span className="pay-invoice-head__num cell-mono">
                                  {projectNumberFor(r.inv.project)}
                                </span>
                              )}
                              {r.inv.project || '—'}
                              {r.inv.client ? ` · ${r.inv.client}` : ''}
                              {r.inv.weekStart ? ` · week ${formatDate(r.inv.weekStart)}` : ''}
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
                      {r.contractors.map((ic) => (
                        <tr key={ic.id} className={ic.paid ? 'row-static' : ''}>
                          <td>{ic.contractor}</td>
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
                      ))}
                    </tbody>
                  )
                })}
              </table>
            </div>
          )}

          {/* Horas invoice-less a pagar (sin factura al cliente): overage y sp_internal. */}
          {renderToPay('overage', overagePending)}
          {renderToPay('sp_internal', spInternalPending)}

          {/* Pagos invoice-less ya hechos (read-only), separados por allocation. */}
          {renderPaid('overage', overagePaid)}
          {renderPaid('sp_internal', spInternalPaid)}
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
                extraValid={selected.length > 0}
                summaryName={payTarget.user}
                summaryMeta={`${label.cap} · ${selected.length} of ${payTarget.entries.length} ${
                  payTarget.entries.length === 1 ? 'entry' : 'entries'
                }`}
                summaryFigure={`${formatHours(selHours)} h`}
                summaryFigureLabel={`${label.cap} hours (selected)`}
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
