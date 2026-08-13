import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Pencil, Settings2, X } from 'lucide-react'
import { ContractBadge } from './ContractBadge'
import { contractStatus, daysRemaining } from '../lib/projectsData'
import { api } from '../lib/api'
import { formatDate, formatDateTime } from '../lib/format'

const FIELDS = [
  { key: 'client', label: 'Client' },
  { key: 'projectName', label: 'Project Name' },
  { key: 'projectNumber', label: 'Project Number' },
  { key: 'customerName', label: 'Customer Name' },
  { key: 'customerCode', label: 'Customer Code' },
  { key: 'proposalName', label: 'Proposal Name' },
  { key: 'proposalNumber', label: 'Proposal Number' },
  { key: 'approver', label: 'Approver' },
  { key: 'customerManager', label: 'Customer Manager' },
  { key: 'leadDeveloper', label: 'Lead Developer' },
  { key: 'contractNumber', label: 'Contract Number' },
]

// Etiquetas legibles para el log de auditoría.
const FIELD_LABELS = Object.fromEntries(FIELDS.map((f) => [f.key, f.label]))
FIELD_LABELS.contractExpirationDate = 'Contract Expiration Date'

/**
 * Drawer de detalle de proyecto (FR-07): campos en modo lectura + botón Edit +
 * log de auditoría.
 *
 * @param {{
 *   project: object,
 *   onClose: () => void,
 *   onEdit: () => void,           // campos legacy (contrato, customer, etc.) — siempre disponible
 *   onEditSow?: () => void,       // SOW/Scope/Maintenance del wizard — solo si el proyecto tiene clientId
 * }} props
 */
export function ProjectDetailDrawer({ project, onClose, onEdit, onEditSow }) {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const drawerRef = useRef(null)

  const days = daysRemaining(project.contractExpirationDate)
  const status = contractStatus(days)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.projects.getHistory(project.id)
      .then((rows) => !cancelled && setHistory(rows))
      .catch(() => !cancelled && setHistory([]))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [project.id])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

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
        aria-labelledby="project-drawer-title"
        ref={drawerRef}
        onClick={(e) => e.stopPropagation()}
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      >
        <div className="drawer__head">
          <div>
            <span className="drawer__kicker">Project</span>
            <h2 className="drawer__title" id="project-drawer-title">
              {project.projectName}
            </h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="drawer__provider">
          <div className="drawer__provider-id">
            <span className="drawer__provider-name">{project.client}</span>
            <span className="drawer__provider-meta">
              {project.projectNumber}
              {project.contractExpirationDate
                ? ` · expires ${formatDate(project.contractExpirationDate)}`
                : ' · no contract'}
              {days != null && (
                <> · {days < 0 ? `${Math.abs(days)} d overdue` : `${days} d`}</>
              )}
            </span>
          </div>
          <ContractBadge status={status} />
        </div>

        <div className="drawer__section">
          <span className="drawer__section-label">Project details</span>
          <dl className="drawer__facts">
            {FIELDS.map((field) => (
              <div className="drawer__fact" key={field.key}>
                <dt>{field.label}</dt>
                <dd>{project[field.key] || '—'}</dd>
              </div>
            ))}
            <div className="drawer__fact">
              <dt>Contract Expiration</dt>
              <dd>
                {project.contractExpirationDate
                  ? formatDate(project.contractExpirationDate)
                  : '—'}
              </dd>
            </div>
            <div className="drawer__fact">
              <dt>Zoho Status</dt>
              <dd>{project.zohoStatus || '—'}</dd>
            </div>
          </dl>
        </div>

        <div className="drawer__section">
          <span className="drawer__section-label">Audit log</span>
          {loading ? (
            <p className="drawer__empty">Loading history…</p>
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

        <div className="drawer__actions">
          <div className="drawer__actions-row">
            {project.clientId && onEditSow && (
              <button type="button" className="btn btn--ghost" onClick={onEditSow}>
                <Settings2 size={16} strokeWidth={2.2} aria-hidden="true" />
                Edit SOW &amp; Scope
              </button>
            )}
            <button type="button" className="btn btn--pay drawer__advance" onClick={onEdit}>
              <Pencil size={16} strokeWidth={2.2} aria-hidden="true" />
              Edit
            </button>
          </div>
        </div>
      </motion.aside>
    </motion.div>
  )
}
