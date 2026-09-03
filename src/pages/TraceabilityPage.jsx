import { useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Check, FileText, X } from 'lucide-react'
import { api } from '../lib/api'
import { downloadTracePdf } from '../lib/tracePdf'
import { BillingBadge } from '../components/BillingBadge'
import { formatDate, formatDateTime, formatHours } from '../lib/format'

const EMPTY_FILTERS = { search: '', contractor: '', project: '', dateFrom: '', dateTo: '' }

function fmtAmount(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function billingStatus(trace) {
  if (trace.paymentId) return 'Paid'
  if (trace.invoiceStatus === 'Collected') return 'Collected'
  if (trace.invoiceId) return 'Invoiced'
  return 'Pending'
}

export function TraceabilityPage() {
  const { user } = useOutletContext()
  const [rows, setRows] = useState([])
  const [status, setStatus] = useState('loading')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    api.trace.search({
      contractor: filters.contractor || undefined,
      project: filters.project || undefined,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
    })
      .then((data) => {
        if (cancelled) return
        setRows(data)
        setStatus('ready')
      })
      .catch((err) => {
        if (cancelled) return
        console.error('Could not load trace data:', err)
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [filters.contractor, filters.project, filters.dateFrom, filters.dateTo])

  const visible = useMemo(() => {
    if (!filters.search) return rows
    const q = filters.search.toLowerCase()
    return rows.filter(
      (r) =>
        (r.userName ?? '').toLowerCase().includes(q) ||
        (r.project ?? '').toLowerCase().includes(q) ||
        (r.client ?? '').toLowerCase().includes(q) ||
        (r.supplierInvoiceNumber ?? '').toLowerCase().includes(q) ||
        (r.zohoLogId ?? '').toLowerCase().includes(q),
    )
  }, [rows, filters.search])

  const filtersActive =
    filters.search || filters.contractor || filters.project || filters.dateFrom || filters.dateTo

  return (
    <>
      <motion.header
        className="masthead"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="masthead__top">
          <span className="masthead__kicker">End-to-end traceability</span>
          <span className="masthead__rule" aria-hidden="true" />
        </div>
        <h1 className="masthead__title">Traceability</h1>
        <p className="masthead__sub">
          Full lifecycle of each logged hour, from Zoho to contractor payment.
          Click any row to see the complete timeline.
        </p>
      </motion.header>

      {status === 'error' && (
        <div className="state state--error">
          <AlertTriangle size={28} strokeWidth={1.8} />
          <h2 className="state__title">Could not load traceability data</h2>
          <p className="state__text">Check your connection and try again.</p>
        </div>
      )}

      {status !== 'error' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.05 }}
        >
          <section className="filterbar" aria-label="Filters">
            <div className="filterbar__head">
              <span className="filterbar__title">Filters</span>
            </div>
            <div className="filterbar__controls">
              <div className="filterfield">
                <span className="filterfield__label">Search</span>
                <input
                  type="text"
                  className="filterfield__input"
                  placeholder="Contractor, project, invoice #…"
                  value={filters.search}
                  onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))}
                />
              </div>
              <div className="filterfield">
                <span className="filterfield__label">Contractor</span>
                <input
                  type="text"
                  className="filterfield__input"
                  placeholder="Name…"
                  value={filters.contractor}
                  onChange={(e) => setFilters((p) => ({ ...p, contractor: e.target.value }))}
                />
              </div>
              <div className="filterfield">
                <span className="filterfield__label">Project</span>
                <input
                  type="text"
                  className="filterfield__input"
                  placeholder="Name…"
                  value={filters.project}
                  onChange={(e) => setFilters((p) => ({ ...p, project: e.target.value }))}
                />
              </div>
              <div className="filterfield">
                <span className="filterfield__label">From</span>
                <input
                  type="date"
                  className="filterfield__input"
                  value={filters.dateFrom}
                  max={filters.dateTo || undefined}
                  onChange={(e) => setFilters((p) => ({ ...p, dateFrom: e.target.value }))}
                />
              </div>
              <div className="filterfield">
                <span className="filterfield__label">To</span>
                <input
                  type="date"
                  className="filterfield__input"
                  value={filters.dateTo}
                  min={filters.dateFrom || undefined}
                  onChange={(e) => setFilters((p) => ({ ...p, dateTo: e.target.value }))}
                />
              </div>
              {filtersActive && (
                <button
                  type="button"
                  className="btn btn--ghost filterbar__clear"
                  onClick={() => setFilters(EMPTY_FILTERS)}
                >
                  Clear
                </button>
              )}
            </div>
          </section>

          <div className="toolbar">
            <span className="toolbar__count">
              {status === 'loading' ? '…' : visible.length}{' '}
              {visible.length === 1 ? 'entry' : 'entries'}
            </span>
          </div>

          {status === 'loading' && <p className="state__hint">Loading…</p>}

          {status === 'ready' && visible.length === 0 && (
            <div className="empty">No entries match the current filters.</div>
          )}

          {status === 'ready' && visible.length > 0 && (
            <div className="table-wrap table-wrap--scroll">
              <table className="table proj-table">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Contractor</th>
                    <th scope="col" className="col-num">Hours</th>
                    <th scope="col">Project</th>
                    <th scope="col">Client</th>
                    <th scope="col">Invoice #</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r, index) => (
                    <motion.tr
                      key={r.timeEntryId}
                      className={selected?.timeEntryId === r.timeEntryId ? 'row--selected' : ''}
                      style={{ cursor: 'pointer' }}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, delay: Math.min(index * 0.01, 0.2) }}
                      onClick={() => setSelected(r)}
                      title="Click to view full timeline"
                    >
                      <td className="cell-mono">{formatDate(r.logDate)}</td>
                      <td>{r.userName}</td>
                      <td className="col-num cell-mono">{formatHours(r.hours)}</td>
                      <td className="cell-soft">{r.project ?? '—'}</td>
                      <td className="cell-soft">{r.client ?? '—'}</td>
                      <td className="cell-mono">
                        {r.supplierInvoiceNumber ?? <span className="cell-pop-empty">—</span>}
                      </td>
                      <td>
                        <BillingBadge status={billingStatus(r)} />
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      )}

      <AnimatePresence>
        {selected && (
          <TraceDrawer
            key={`trace-${selected.timeEntryId}`}
            trace={selected}
            generatedBy={user?.email}
            onClose={() => setSelected(null)}
          />
        )}
      </AnimatePresence>
    </>
  )
}

function TraceDrawer({ trace, generatedBy, onClose }) {
  const drawerRef = useRef(null)
  const [collections, setCollections] = useState([])

  useEffect(() => {
    if (!trace.invoiceId) return
    api.trace.getCollectionsForInvoice(trace.invoiceId).then(setCollections).catch(() => {})
  }, [trace.invoiceId])

  // Close on Escape
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function handleExportPdf() {
    downloadTracePdf({ trace, collections, generatedBy })
  }

  const status = billingStatus(trace)

  return (
    <motion.div
      className="drawer-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.aside
        ref={drawerRef}
        className="drawer"
        role="complementary"
        aria-label="Entry timeline"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer__head">
          <div>
            <span className="drawer__kicker">Traceability · Entry #{trace.timeEntryId}</span>
            <h2 className="drawer__title">{trace.userName}</h2>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn--ghost btn--row"
              onClick={handleExportPdf}
              title="Export timeline to PDF"
            >
              <FileText size={14} aria-hidden="true" />
              PDF
            </button>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Entry summary */}
        <div className="drawer__facts" style={{ marginTop: 16 }}>
          <dl className="drawer__fact">
            <dt>Date</dt>
            <dd className="cell-mono">{formatDate(trace.logDate)}</dd>
          </dl>
          <dl className="drawer__fact">
            <dt>Hours</dt>
            <dd className="cell-mono">{formatHours(trace.hours)} h</dd>
          </dl>
          <dl className="drawer__fact">
            <dt>Project</dt>
            <dd>{trace.project ?? '—'}</dd>
          </dl>
          <dl className="drawer__fact">
            <dt>Client</dt>
            <dd>{trace.client ?? '—'}</dd>
          </dl>
          {trace.task && (
            <dl className="drawer__fact">
              <dt>Task</dt>
              <dd>{trace.task}</dd>
            </dl>
          )}
          <dl className="drawer__fact">
            <dt>Status</dt>
            <dd><BillingBadge status={status} /></dd>
          </dl>
        </div>

        {/* Timeline */}
        <p className="drawer__section-label" style={{ marginTop: 24 }}>Timeline</p>
        <Timeline trace={trace} collections={collections} />
      </motion.aside>
    </motion.div>
  )
}

function Timeline({ trace, collections }) {
  const isInvoiced = !!trace.invoiceId
  const isCollected = trace.invoiceStatus === 'Collected' || trace.invoiceStatus === 'Paid'
  const isPaid = !!trace.paymentId

  const steps = [
    {
      label: 'Logged in Zoho',
      done: true,
      date: formatDate(trace.logDate),
      details: [
        `${formatHours(trace.hours)} h`,
        trace.task ? `Task: ${trace.task}` : null,
        trace.zohoLogId ? `Zoho ID: ${trace.zohoLogId}` : null,
        trace.description ? `"${trace.description}"` : null,
      ].filter(Boolean),
    },
    {
      label: 'Synced to App',
      done: true,
      date: trace.syncedAt ? formatDateTime(trace.syncedAt) : '—',
      details: [],
    },
    {
      label: 'Invoiced',
      done: isInvoiced,
      date: isInvoiced ? formatDate(trace.invoiceDate) : null,
      details: isInvoiced
        ? [
            trace.spInvoiceNumber ? `SP invoice: ${trace.spInvoiceNumber}` : null,
            trace.invoiceContractor ? `Contractor: ${trace.invoiceContractor}` : null,
            trace.contractorHours != null ? `${formatHours(trace.contractorHours)} h` : null,
            trace.invoicedBy ? `By: ${trace.invoicedBy}` : null,
          ].filter(Boolean)
        : [],
    },
    {
      label: 'Collected',
      done: isCollected,
      date: isCollected ? formatDate(trace.lastCollectionDate) : null,
      details: isCollected
        ? [
            `Total: $${fmtAmount(trace.collectedAmount)}`,
            ...collections.map(
              (c) =>
                `${formatDate(c.collectionDate)}: $${fmtAmount(c.amountReceived)}${c.bankReference ? ` · ${c.bankReference}` : ''}`,
            ),
          ]
        : [],
    },
    {
      label: 'Paid to Contractor',
      done: isPaid,
      date: isPaid ? formatDate(trace.paymentDate) : null,
      details: isPaid
        ? [
            trace.supplierInvoiceNumber ? `Supplier invoice: ${trace.supplierInvoiceNumber}` : null,
            trace.bankMethod ? `Method: ${trace.bankMethod}` : null,
            trace.transferReference ? `Ref: ${trace.transferReference}` : null,
            trace.paidBy ? `By: ${trace.paidBy}` : null,
          ].filter(Boolean)
        : [],
    },
  ]

  // Nodo "activo" = la etapa más avanzada ya alcanzada — mismo criterio visual
  // que <NodeStepper /> (fill cyan + halo), para que el grafo de la app hable
  // el mismo idioma en el flujo horizontal de billing y en este timeline vertical.
  let lastDoneIdx = -1
  steps.forEach((step, i) => {
    if (step.done) lastDoneIdx = i
  })

  return (
    <ol className="trace-timeline">
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1
        const state = i < lastDoneIdx ? 'done' : i === lastDoneIdx ? 'active' : 'idle'
        const edgeState = i > 0 && i <= lastDoneIdx ? 'done' : 'idle'
        return (
          <li key={step.label} className={`trace-timeline__step trace-timeline__step--${state}`}>
            <div className="trace-timeline__rail">
              <span className="trace-timeline__node" aria-hidden="true">
                {state === 'done' && <Check size={11} strokeWidth={2.5} />}
              </span>
              {!isLast && (
                <span
                  className={`trace-timeline__edge trace-timeline__edge--${edgeState}`}
                  aria-hidden="true"
                />
              )}
            </div>
            <div className="trace-timeline__body">
              <div className="trace-timeline__row">
                <span className="trace-timeline__label">{step.label}</span>
                {step.date && <span className="trace-timeline__date">{step.date}</span>}
              </div>
              {step.details.length > 0 && (
                <ul className="trace-timeline__details">
                  {step.details.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
              {!step.done && <span className="trace-timeline__pending">Pending</span>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
