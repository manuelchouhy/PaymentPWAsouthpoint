import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { AlertTriangle, CheckCircle, Clock, RefreshCw, XCircle } from 'lucide-react'
import { api } from '../lib/api'

function statusOf(row) {
  if (row.sentAt) return { label: 'Sent', color: '#16a34a', Icon: CheckCircle }
  if (row.failedAt) return { label: 'Failed', color: '#dc2626', Icon: XCircle }
  return { label: 'Pending', color: '#d97706', Icon: Clock }
}

function fmtTs(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function EmailOutboxPage() {
  const { can } = useOutletContext()
  const [rows, setRows] = useState([])
  const [loadStatus, setLoadStatus] = useState('loading')
  const [retrying, setRetrying] = useState(null)

  useEffect(() => {
    if (can('settings.view')) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function load() {
    setLoadStatus('loading')
    try {
      setRows(await api.emailOutbox.list())
      setLoadStatus('ready')
    } catch {
      setLoadStatus('error')
    }
  }

  async function handleRetry(id) {
    setRetrying(id)
    try {
      await api.emailOutbox.retry(id)
      await load()
    } finally {
      setRetrying(null)
    }
  }

  if (!can('settings.view')) {
    return (
      <div className="state state--error">
        <AlertTriangle size={28} strokeWidth={1.8} />
        <h2 className="state__title">Access denied</h2>
        <p className="state__text">Administrator role required.</p>
      </div>
    )
  }

  const counts = { sent: 0, pending: 0, failed: 0 }
  for (const r of rows) {
    if (r.sentAt) counts.sent++
    else if (r.failedAt) counts.failed++
    else counts.pending++
  }

  return (
    <>
      <header className="masthead">
        <div className="masthead__top">
          <span className="masthead__kicker">Notification settings</span>
          <span className="masthead__rule" aria-hidden="true" />
        </div>
        <h1 className="masthead__title">Email Outbox</h1>
        <p className="masthead__sub">
          Emails queued for delivery via Resend. Processed every 5 minutes by the{' '}
          <code>process-email-outbox</code> edge function.
        </p>
      </header>

      {loadStatus === 'error' && (
        <div className="state state--error">
          <AlertTriangle size={28} strokeWidth={1.8} />
          <h2 className="state__title">Could not load outbox</h2>
          <p className="state__text">Check your connection and try again.</p>
          <button type="button" className="btn btn--primary" onClick={load}>Retry</button>
        </div>
      )}

      {loadStatus === 'loading' && <p className="state__hint">Loading…</p>}

      {loadStatus === 'ready' && (
        <>
          {/* KPI summary */}
          <div className="outbox-kpis">
            <div className="outbox-kpi">
              <span className="outbox-kpi__num" style={{ color: '#d97706' }}>{counts.pending}</span>
              <span className="outbox-kpi__label">Pending</span>
            </div>
            <div className="outbox-kpi">
              <span className="outbox-kpi__num" style={{ color: '#16a34a' }}>{counts.sent}</span>
              <span className="outbox-kpi__label">Sent</span>
            </div>
            <div className="outbox-kpi">
              <span className="outbox-kpi__num" style={{ color: '#dc2626' }}>{counts.failed}</span>
              <span className="outbox-kpi__label">Failed</span>
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="empty">No emails in outbox yet.</div>
          ) : (
            <div className="table-wrap table-wrap--scroll">
              <table className="table proj-table">
                <thead>
                  <tr>
                    <th scope="col">Status</th>
                    <th scope="col">Category</th>
                    <th scope="col">Subject</th>
                    <th scope="col">Recipients</th>
                    <th scope="col">Queued</th>
                    <th scope="col">Sent</th>
                    <th scope="col" className="col-num">Retries</th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const { label, color, Icon } = statusOf(r)
                    return (
                      <tr key={r.id}>
                        <td>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6, color }}>
                            <Icon size={13} aria-hidden="true" />
                            {label}
                          </span>
                        </td>
                        <td>
                          <code style={{ fontSize: 11, color: 'var(--text-soft)' }}>
                            {r.category ?? '—'}
                          </code>
                        </td>
                        <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.subject}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-soft)' }}>
                          {r.recipients.length === 0
                            ? <span style={{ color: '#dc2626' }}>None</span>
                            : r.recipients.join(', ')}
                        </td>
                        <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtTs(r.createdAt)}</td>
                        <td style={{ fontSize: 12, whiteSpace: 'nowrap', color: r.sentAt ? '#16a34a' : 'var(--text-soft)' }}>
                          {fmtTs(r.sentAt)}
                        </td>
                        <td className="col-num">{r.retryCount}</td>
                        <td>
                          {r.failedAt && (
                            <button
                              type="button"
                              className="btn btn--ghost"
                              onClick={() => handleRetry(r.id)}
                              disabled={retrying === r.id}
                              aria-busy={retrying === r.id}
                            >
                              <RefreshCw
                                size={13}
                                className={retrying === r.id ? 'icon-spin' : ''}
                                aria-hidden="true"
                              />
                              Retry
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  )
}
