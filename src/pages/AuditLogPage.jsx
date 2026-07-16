import { useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Download, X } from 'lucide-react'
import { api } from '../lib/api'

const ACTIONS = [
  'invoice.create',
  'invoice.status_change',
  'collection.register',
  'payment.create',
  'project.create',
  'project.update',
  'supplier_contract.create',
  'supplier_contract.update',
  'supplier_contract.renew',
  'supplier_contract.mark_renewal',
]

const RESOURCE_TYPES = ['invoice', 'collection', 'payment', 'project', 'supplier_contract']

const EMPTY_FILTERS = { search: '', action: '', resourceType: '', dateFrom: '', dateTo: '' }

export function AuditLogPage() {
  const { can } = useOutletContext()
  const [rows, setRows] = useState([])
  const [status, setStatus] = useState('loading')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [detail, setDetail] = useState(null)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    api.audit.list({
      action: filters.action || undefined,
      resourceType: filters.resourceType || undefined,
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
        console.error('Could not load audit log:', err)
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [filters.action, filters.resourceType, filters.dateFrom, filters.dateTo])

  const visible = useMemo(() => {
    if (!filters.search) return rows
    const q = filters.search.toLowerCase()
    return rows.filter(
      (r) =>
        r.actorEmail.toLowerCase().includes(q) ||
        r.action.toLowerCase().includes(q) ||
        (r.resourceType ?? '').toLowerCase().includes(q),
    )
  }, [rows, filters.search])

  const filtersActive =
    filters.search || filters.action || filters.resourceType || filters.dateFrom || filters.dateTo

  function exportCsv() {
    const headers = ['timestamp', 'actor_email', 'actor_role', 'action', 'resource_type', 'resource_id']
    const lines = [
      headers.join(','),
      ...visible.map((r) =>
        [r.timestamp, r.actorEmail, r.actorRole ?? '', r.action, r.resourceType ?? '', r.resourceId ?? '']
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(','),
      ),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const ts = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '')
    a.download = `contractors_audit_log_${ts}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!can('settings.view')) {
    return (
      <div className="state state--error">
        <AlertTriangle size={28} strokeWidth={1.8} />
        <h2 className="state__title">Access restricted</h2>
        <p className="state__text">Only Administrators can view the Audit Log.</p>
      </div>
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
          <span className="masthead__kicker">Administrator settings</span>
          <span className="masthead__rule" aria-hidden="true" />
        </div>
        <h1 className="masthead__title">Audit Log</h1>
        <p className="masthead__sub">
          Immutable record of all critical actions. Only visible to Administrators.
        </p>
      </motion.header>

      {status === 'error' && (
        <div className="state state--error">
          <AlertTriangle size={28} strokeWidth={1.8} />
          <h2 className="state__title">Could not load the audit log</h2>
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
              <button type="button" className="btn btn--ghost proj-alerts-link" onClick={exportCsv}>
                <Download size={14} aria-hidden="true" />
                Export CSV
              </button>
            </div>
            <div className="filterbar__controls">
              <div className="filterfield">
                <span className="filterfield__label">Search</span>
                <input
                  type="text"
                  className="filterfield__input"
                  placeholder="Email, action…"
                  value={filters.search}
                  onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))}
                />
              </div>
              <div className="filterfield">
                <span className="filterfield__label">Action</span>
                <select
                  className="filterfield__input"
                  value={filters.action}
                  onChange={(e) => setFilters((p) => ({ ...p, action: e.target.value }))}
                >
                  <option value="">All actions</option>
                  {ACTIONS.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </div>
              <div className="filterfield">
                <span className="filterfield__label">Resource</span>
                <select
                  className="filterfield__input"
                  value={filters.resourceType}
                  onChange={(e) => setFilters((p) => ({ ...p, resourceType: e.target.value }))}
                >
                  <option value="">All resources</option>
                  {RESOURCE_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
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
              {visible.length === 1 ? 'event' : 'events'}
            </span>
          </div>

          {status === 'loading' && <p className="state__hint">Loading audit log…</p>}

          {status === 'ready' && visible.length === 0 && (
            <div className="empty">No audit events match the current filters.</div>
          )}

          {status === 'ready' && visible.length > 0 && (
            <div className="table-wrap table-wrap--scroll">
              <table className="table proj-table">
                <thead>
                  <tr>
                    <th scope="col">Timestamp</th>
                    <th scope="col">Actor</th>
                    <th scope="col">Role</th>
                    <th scope="col">Action</th>
                    <th scope="col">Resource</th>
                    <th scope="col">ID</th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r, index) => (
                    <motion.tr
                      key={r.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, delay: Math.min(index * 0.01, 0.2) }}
                    >
                      <td className="cell-mono cell-soft" style={{ whiteSpace: 'nowrap' }}>
                        {new Date(r.timestamp).toLocaleString('en-US', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </td>
                      <td className="cell-soft">{r.actorEmail}</td>
                      <td>
                        {r.actorRole ? (
                          <span className="badge badge--invoiced">{r.actorRole}</span>
                        ) : (
                          <span className="cell-pop-empty">—</span>
                        )}
                      </td>
                      <td className="cell-mono">{r.action}</td>
                      <td>{r.resourceType ?? <span className="cell-pop-empty">—</span>}</td>
                      <td className="cell-mono">
                        {r.resourceId != null ? r.resourceId : <span className="cell-pop-empty">—</span>}
                      </td>
                      <td>
                        {(r.before || r.after) && (
                          <button
                            type="button"
                            className="btn btn--ghost btn--row"
                            onClick={() => setDetail(r)}
                          >
                            Diff
                          </button>
                        )}
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
        {detail && (
          <DiffModal key={`diff-${detail.id}`} row={detail} onClose={() => setDetail(null)} />
        )}
      </AnimatePresence>
    </>
  )
}

function DiffModal({ row, onClose }) {
  return (
    <motion.div
      className="modal-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="modal"
        style={{ maxWidth: 600 }}
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ type: 'spring', damping: 26, stiffness: 320, mass: 0.8 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          <div>
            <span className="modal__kicker">Audit event</span>
            <h2 className="modal__title">{row.action}</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div style={{ display: 'grid', gap: 16, marginTop: 20 }}>
          {row.before && (
            <div>
              <p style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Before</p>
              <pre style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 6, padding: 12, fontSize: 12, overflowX: 'auto', color: 'var(--no)', margin: 0 }}>
                {JSON.stringify(row.before, null, 2)}
              </pre>
            </div>
          )}
          {row.after && (
            <div>
              <p style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>After</p>
              <pre style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 6, padding: 12, fontSize: 12, overflowX: 'auto', color: 'var(--ok)', margin: 0 }}>
                {JSON.stringify(row.after, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
