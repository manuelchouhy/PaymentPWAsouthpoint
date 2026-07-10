import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, X } from 'lucide-react'
import { BillingBadge } from './BillingBadge'
import { Avatar } from './Avatar'
import { nextBillingStatus } from '../lib/data'
import { api } from '../lib/api'
import { formatDate, formatDateTime, formatHours } from '../lib/format'

const ENTRY_SCROLL_THRESHOLD = 20

function formatAmount(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Drawer lateral con el detalle de una factura (FR-06). Se abre al clickear una
 * fila con Billing Status != Pending. Permite avanzar el estado
 * (Invoiced → Collected → Paid) usando las transiciones validadas del modelo.
 *
 * @param {{
 *   invoice: import('../lib/data').Invoice,
 *   entries: import('../lib/data').TimeEntry[],
 *   onClose: () => void,
 *   onChangeStatus: (toStatus: string) => Promise<object>,
 * }} props
 */
export function InvoiceDetailDrawer({ invoice, entries, onClose, onChangeStatus }) {
  const [history, setHistory] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [payment, setPayment] = useState(null)
  const [changing, setChanging] = useState(false)
  const [error, setError] = useState('')
  const drawerRef = useRef(null)

  const next = nextBillingStatus(invoice.status) // 'Collected' | 'Paid' | null
  const totalHours = entries.reduce((sum, entry) => sum + entry.hours, 0)

  // Cargar el historial al abrir / cambiar de factura.
  useEffect(() => {
    let cancelled = false
    setLoadingHistory(true)
    api.invoices.getStatusHistory(invoice.id)
      .then((rows) => {
        if (!cancelled) setHistory(rows)
      })
      .catch(() => {
        if (!cancelled) setHistory([])
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false)
      })
    // Pago al contractor (si la factura ya está Paid).
    api.payments.getByInvoice(invoice.id)
      .then((p) => !cancelled && setPayment(p))
      .catch(() => !cancelled && setPayment(null))
    return () => {
      cancelled = true
    }
  }, [invoice.id])

  // Bloqueo de scroll de fondo + cierre con Escape.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  async function handleAdvance() {
    if (!next || changing) return
    setError('')
    setChanging(true)
    try {
      const historyEntry = await onChangeStatus(next)
      // Optimista: sumamos la transición al historial mostrado.
      if (historyEntry) {
        setHistory((prev) => [
          {
            id: `local-${prev.length}`,
            fromStatus: historyEntry.fromStatus,
            toStatus: historyEntry.toStatus,
            changedAt: historyEntry.changedAt,
            changedBy: historyEntry.changedBy,
            note: historyEntry.note,
          },
          ...prev,
        ])
      }
    } catch (err) {
      setError(err?.message ?? 'Could not update the status.')
    } finally {
      setChanging(false)
    }
  }

  const scrollEntries = entries.length > ENTRY_SCROLL_THRESHOLD

  return (
    <motion.div
      className="drawer-backdrop"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="invoice-drawer-title"
        ref={drawerRef}
        onClick={(event) => event.stopPropagation()}
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      >
        <div className="drawer__head">
          <div>
            <span className="drawer__kicker">Invoice</span>
            <h2 className="drawer__title" id="invoice-drawer-title">
              {invoice.supplierInvoiceNumber}
            </h2>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="drawer__provider">
          <Avatar name={invoice.userName} size="md" />
          <div className="drawer__provider-id">
            <span className="drawer__provider-name">{invoice.userName}</span>
            <span className="drawer__provider-meta">Contractor</span>
          </div>
          <BillingBadge status={invoice.status} />
        </div>

        <dl className="drawer__facts">
          <div className="drawer__fact">
            <dt>Invoice date</dt>
            <dd>{formatDate(invoice.invoiceDate)}</dd>
          </div>
          <div className="drawer__fact">
            <dt>Total amount</dt>
            <dd className="drawer__amount">${formatAmount(invoice.totalAmount)}</dd>
          </div>
          <div className="drawer__fact">
            <dt>Hours</dt>
            <dd>{formatHours(totalHours)} h</dd>
          </div>
          <div className="drawer__fact">
            <dt>Issued by</dt>
            <dd>{invoice.createdBy ?? '—'}</dd>
          </div>
        </dl>

        {invoice.notes && (
          <div className="drawer__notes">
            <span className="drawer__section-label">Notes</span>
            <p>{invoice.notes}</p>
          </div>
        )}

        <div className="drawer__section">
          <span className="drawer__section-label">
            Time entries · {entries.length}
          </span>
          <div
            className={`drawer__entries${scrollEntries ? ' drawer__entries--scroll' : ''}`}
          >
            {entries.map((entry) => (
              <div key={entry.id} className="drawer__entry">
                <span className="drawer__entry-date">{formatDate(entry.date)}</span>
                <span className="drawer__entry-task" title={entry.task}>
                  {entry.task}
                </span>
                <span className="drawer__entry-hours">
                  {formatHours(entry.hours)} h
                </span>
              </div>
            ))}
            {entries.length === 0 && (
              <p className="drawer__empty">No time entries linked.</p>
            )}
          </div>
        </div>

        {payment && (
          <div className="drawer__section">
            <span className="drawer__section-label">Contractor payment</span>
            <dl className="drawer__facts">
              <div className="drawer__fact">
                <dt>Amount paid</dt>
                <dd className="drawer__amount">${formatAmount(payment.amountPaid)}</dd>
              </div>
              <div className="drawer__fact">
                <dt>Payment date</dt>
                <dd>
                  {formatDate(payment.paymentDate)}
                  {payment.backDated ? ' (back-dated)' : ''}
                </dd>
              </div>
              <div className="drawer__fact">
                <dt>Bank / method</dt>
                <dd>{payment.bankMethod || '—'}</dd>
              </div>
              <div className="drawer__fact">
                <dt>Reference</dt>
                <dd>{payment.transferReference || '—'}</dd>
              </div>
            </dl>
          </div>
        )}

        <div className="drawer__section">
          <span className="drawer__section-label">Status history</span>
          {loadingHistory ? (
            <p className="drawer__empty">Loading history…</p>
          ) : history.length === 0 ? (
            <p className="drawer__empty">No status changes recorded.</p>
          ) : (
            <ul className="drawer__history">
              {history.map((row) => (
                <li key={row.id} className="drawer__history-row">
                  <span className="drawer__history-status">
                    {row.fromStatus && (
                      <>
                        <span className="drawer__history-from">{row.fromStatus}</span>
                        <ArrowRight size={12} aria-hidden="true" />
                      </>
                    )}
                    <strong>{row.toStatus}</strong>
                  </span>
                  <span className="drawer__history-meta">
                    {formatDateTime(row.changedAt)}
                    {row.changedBy ? ` · ${row.changedBy}` : ''}
                  </span>
                  {row.note && <span className="drawer__history-note">{row.note}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && (
          <p className="drawer__error" role="alert">
            {error}
          </p>
        )}

        <div className="drawer__actions">
          {next ? (
            <motion.button
              type="button"
              className="btn btn--pay drawer__advance"
              onClick={handleAdvance}
              disabled={changing}
              whileTap={changing ? undefined : { scale: 0.97 }}
            >
              {changing ? (
                <span className="spinner" aria-hidden="true" />
              ) : (
                <ArrowRight size={16} strokeWidth={2.2} aria-hidden="true" />
              )}
              {changing ? 'Updating…' : `Mark as ${next}`}
            </motion.button>
          ) : (
            <p className="drawer__done">
              Invoice <strong>Paid</strong> — no pending actions.
            </p>
          )}
        </div>
      </motion.aside>
    </motion.div>
  )
}
