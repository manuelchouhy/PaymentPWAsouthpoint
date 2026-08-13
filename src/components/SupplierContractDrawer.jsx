import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, BellOff, Download, Pencil, RefreshCw, Star, X } from 'lucide-react'
import { SupplierStatusBadge } from './SupplierStatusBadge'
import { displaySupplierStatus } from '../lib/supplierContractsData'
import { daysRemaining } from '../lib/projectsData'
import { api } from '../lib/api'
import { formatDate, formatDateTime } from '../lib/format'

const FIELD_LABELS = {
  supplierName: 'Supplier',
  contractNumber: 'Contract #',
  startDate: 'Start Date',
  expirationDate: 'Expiration Date',
  renewalDate: 'Renewal Date',
  paymentTerms: 'Payment Terms',
  renewalType: 'Renewal Type',
  isPrioritySupplier: 'Priority Supplier',
  weeklyContractedHours: 'Contracted Hours/Week',
}

const ACTION_LABELS = {
  renew: 'Renewed',
  renew_in_progress: 'Marked as Renewal in Progress',
  manual_dismiss: 'Manually dismissed',
}

/** Texto de una entrada del alert log: email enviado o acción tomada. */
function alertLabel(a) {
  if (a.actionTaken) return ACTION_LABELS[a.actionTaken] ?? a.actionTaken
  if (a.emailSentAt) {
    const band = a.thresholdCrossed === 0 ? 'overdue' : `${a.thresholdCrossed} days`
    return `Email sent (threshold ${band})`
  }
  return 'Alert'
}

/**
 * Drawer de detalle de Supplier Contract (FR-14 / FR-15).
 *
 * @param {{ contract: object, onClose: () => void, onEdit: () => void,
 *           onRenew?: () => void, onMarkRenewal?: () => void }} props
 */
export function SupplierContractDrawer({ contract, onClose, onEdit, onRenew, onMarkRenewal }) {
  const [history, setHistory] = useState([])
  const [renewals, setRenewals] = useState([])
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfMsg, setPdfMsg] = useState('')
  const drawerRef = useRef(null)

  const days = daysRemaining(contract.expirationDate)
  const status = displaySupplierStatus(contract)
  const isExpired = status === 'Expired'
  const isRenewing = status === 'Renewal in Progress'
  const isDemoPdf = typeof contract.pdfUrl === 'string' && contract.pdfUrl.startsWith('demo://')

  async function openPdf() {
    setPdfMsg('')
    if (isDemoPdf) {
      setPdfMsg('Demo mode: the PDF cannot be downloaded (only the filename was saved).')
      return
    }
    setPdfBusy(true)
    try {
      const url = await api.supplierContracts.getPdfUrl(contract.pdfUrl)
      if (url) window.open(url, '_blank', 'noopener')
      else setPdfMsg('Could not generate the download link.')
    } finally {
      setPdfBusy(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      api.supplierContracts.getHistory(contract.id),
      api.supplierContracts.getRenewalHistory(contract),
      api.supplierContracts.getAlertHistory(contract.id),
    ])
      .then(([h, r, a]) => {
        if (cancelled) return
        setHistory(h)
        setRenewals(r)
        setAlerts(a)
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [contract.id])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const facts = [
    ['Contract #', contract.contractNumber],
    ['Start Date', formatDate(contract.startDate)],
    ['Expiration Date', formatDate(contract.expirationDate)],
    ['Renewal Date', formatDate(contract.renewalDate)],
    ['Payment Terms', contract.paymentTerms],
    ['Renewal Type', contract.renewalType],
    ['Priority Supplier', contract.isPrioritySupplier ? 'Yes' : 'No'],
    [
      'Contracted Hours/Week',
      contract.weeklyContractedHours == null ? '—' : contract.weeklyContractedHours,
    ],
  ]

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
        aria-labelledby="sc-drawer-title"
        ref={drawerRef}
        onClick={(e) => e.stopPropagation()}
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      >
        <div className="drawer__head">
          <div>
            <span className="drawer__kicker">Supplier Contract</span>
            <h2 className="drawer__title" id="sc-drawer-title">
              {contract.isPrioritySupplier && (
                <Star size={15} aria-hidden="true" className="sc-priority-star" />
              )}
              {contract.supplierName}
            </h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="drawer__provider">
          <div className="drawer__provider-id">
            <span className="drawer__provider-name">{contract.contractNumber}</span>
            <span className="drawer__provider-meta">
              expires {formatDate(contract.expirationDate)}
              {days != null && (
                <> · {days < 0 ? `${Math.abs(days)} d overdue` : `${days} d`}</>
              )}
            </span>
          </div>
          <SupplierStatusBadge status={status} />
        </div>

        <div className="drawer__section">
          <span className="drawer__section-label">Contract details</span>
          <dl className="drawer__facts">
            {facts.map(([label, value]) => (
              <div className="drawer__fact" key={label}>
                <dt>{label}</dt>
                <dd>{value || '—'}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="drawer__section">
          <span className="drawer__section-label">Contract PDF</span>
          {contract.pdfUrl ? (
            <button type="button" className="sc-pdf-link" onClick={openPdf} disabled={pdfBusy}>
              {pdfBusy ? <span className="spinner" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
              {pdfBusy ? 'Generating link…' : 'Download PDF'}
            </button>
          ) : (
            <p className="drawer__empty">No PDF uploaded. Add one via Edit.</p>
          )}
          {pdfMsg && <p className="drawer__empty">{pdfMsg}</p>}
        </div>

        <div className="drawer__section">
          <span className="drawer__section-label">Renewal History</span>
          {loading ? (
            <p className="drawer__empty">Loading…</p>
          ) : renewals.length === 0 ? (
            <p className="drawer__empty">No previous versions.</p>
          ) : (
            <ul className="drawer__history">
              {renewals.map((r) => (
                <li key={r.id} className="drawer__history-row">
                  <span className="drawer__history-status">
                    <strong>{r.contractNumber}</strong>
                  </span>
                  <span className="drawer__history-meta">
                    {formatDate(r.startDate)} → {formatDate(r.expirationDate)}
                    {r.pdfUrl ? ' · PDF available' : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="drawer__section">
          <span className="drawer__section-label">Audit log</span>
          {loading ? (
            <p className="drawer__empty">Loading…</p>
          ) : history.length === 0 ? (
            <p className="drawer__empty">No changes recorded.</p>
          ) : (
            <ul className="drawer__history">
              {history.map((row) => (
                <li key={row.id} className="drawer__history-row">
                  <span className="drawer__history-status">
                    <strong>{FIELD_LABELS[row.fieldName] ?? row.fieldName}</strong>
                  </span>
                  <span className="drawer__history-status">
                    <span className="drawer__history-from">{row.oldValue || '—'}</span>
                    <ArrowRight size={12} aria-hidden="true" />
                    {row.newValue || '—'}
                  </span>
                  <span className="drawer__history-meta">
                    {formatDateTime(row.changedAt)}
                    {row.changedBy ? ` · ${row.changedBy}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="drawer__section">
          <span className="drawer__section-label">Alert history</span>
          {loading ? (
            <p className="drawer__empty">Loading…</p>
          ) : alerts.length === 0 ? (
            <p className="drawer__empty">No alerts recorded.</p>
          ) : (
            <ul className="drawer__history">
              {alerts.map((a) => (
                <li key={a.id} className="drawer__history-row">
                  <span className="drawer__history-status">
                    <strong>{alertLabel(a)}</strong>
                  </span>
                  <span className="drawer__history-meta">
                    {formatDateTime(a.emailSentAt ?? a.dismissedAt ?? a.createdAt)}
                    {a.dismissedBy ? ` · ${a.dismissedBy}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="drawer__actions drawer__actions--stack">
          {isRenewing && contract.snoozeUntil && (
            <p className="sc-snooze-note">
              <BellOff size={13} aria-hidden="true" />
              Renewal in progress · snoozed until {formatDate(String(contract.snoozeUntil).slice(0, 10))}
            </p>
          )}
          <div className="drawer__actions-row">
            <button type="button" className="btn btn--ghost" onClick={onEdit}>
              <Pencil size={16} strokeWidth={2.2} aria-hidden="true" />
              Edit
            </button>
            {!isExpired && onMarkRenewal && (
              <button type="button" className="btn btn--ghost" onClick={onMarkRenewal}>
                <BellOff size={16} strokeWidth={2.2} aria-hidden="true" />
                Renewal in Progress
              </button>
            )}
            {onRenew && (
              <button type="button" className="btn btn--pay drawer__advance" onClick={onRenew}>
                <RefreshCw size={16} strokeWidth={2.2} aria-hidden="true" />
                Renew
              </button>
            )}
          </div>
        </div>
      </motion.aside>
    </motion.div>
  )
}
