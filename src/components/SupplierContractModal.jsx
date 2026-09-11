import { useEffect, useState } from 'react'
import { BellOff, Pencil, RefreshCw, Star, X } from 'lucide-react'
import { SupplierStatusBadge } from './SupplierStatusBadge'
import { displaySupplierStatus } from '../lib/supplierContractsData'
import { daysRemaining } from '../lib/projectsData'
import { api } from '../lib/api'
import { formatDate, formatDateTime } from '../lib/format'
import { useScrollLock } from '../lib/useScrollLock'

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
 * Modal (pop-up centrado) de detalle de Supplier/Vendors Contract (FR-14 / FR-15).
 * Antes era un drawer lateral; ahora reutiliza el sistema de modal
 * (.modal-backdrop / .modal, igual que .modal--entry-detail), conservando las
 * secciones de contenido .drawer__* (facts, historiales, acciones).
 *
 * NO usa framer-motion a propósito (igual que .modal--entry-detail): en una
 * pestaña oculta el `exit` de AnimatePresence no completa y el modal quedaba
 * montado. Con divs planos cierra siempre.
 *
 * @param {{ contract: object, onClose: () => void, onEdit: () => void,
 *           onRenew?: () => void, onMarkRenewal?: () => void }} props
 */
export function SupplierContractModal({ contract, onClose, onEdit, onRenew, onMarkRenewal }) {
  const [renewals, setRenewals] = useState([])
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)

  const days = daysRemaining(contract.expirationDate)
  const status = displaySupplierStatus(contract)
  const isExpired = status === 'Expired'
  const isRenewing = status === 'Renewal in Progress'

  useScrollLock()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      api.supplierContracts.getRenewalHistory(contract),
      api.supplierContracts.getAlertHistory(contract.id),
    ])
      .then(([r, a]) => {
        if (cancelled) return
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
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const facts = [
    ['Contract #', contract.contractNumber],
    ['Start Date', formatDate(contract.startDate)],
    ['Role', contract.role],
    ['Expiration Date', formatDate(contract.expirationDate)],
    ['Renewal Date', formatDate(contract.renewalDate)],
    ['Payment Terms', contract.paymentTerms],
    ['Renewal Type', contract.renewalType],
    ['Priority Supplier', contract.isPrioritySupplier ? 'Yes' : 'No'],
    ['Contracted Hours/Week', contract.weeklyContractedHours],
  ]

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal modal--supplier-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sc-drawer-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer__head">
          <div>
            <span className="drawer__kicker">Vendors Contract</span>
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
                {/* == null / '' -> '—' (no ||: un 0 real, como 0 h/sem, es un
                    valor legítimo y no debe colapsar al placeholder). */}
                <dd>{value === '' || value == null ? '—' : value}</dd>
              </div>
            ))}
          </dl>
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
      </div>
    </div>
  )
}
