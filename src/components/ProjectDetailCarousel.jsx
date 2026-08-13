import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, ChevronLeft, ChevronRight, Pencil, Settings2, X } from 'lucide-react'
import { ContractBadge } from './ContractBadge'
import { contractStatus, daysRemaining } from '../lib/projectsData'
import { api } from '../lib/api'
import { formatDate, formatDateTime } from '../lib/format'

const OVERVIEW_FIELDS = [
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
const FIELD_LABELS = Object.fromEntries(OVERVIEW_FIELDS.map((f) => [f.key, f.label]))
FIELD_LABELS.contractExpirationDate = 'Contract Expiration Date'

function OverviewSlide({ project }) {
  return (
    <dl className="drawer__facts">
      {OVERVIEW_FIELDS.map((field) => (
        <div className="drawer__fact" key={field.key}>
          <dt>{field.label}</dt>
          <dd>{project[field.key] || '—'}</dd>
        </div>
      ))}
      <div className="drawer__fact">
        <dt>Contract Expiration</dt>
        <dd>{project.contractExpirationDate ? formatDate(project.contractExpirationDate) : '—'}</dd>
      </div>
      <div className="drawer__fact">
        <dt>Zoho Status</dt>
        <dd>{project.zohoStatus || '—'}</dd>
      </div>
    </dl>
  )
}

/**
 * Carrusel de detalle de proyecto (Projects and SOW · issue 04). Reemplaza a
 * ProjectDetailDrawer — arranca con un solo slide real (Overview); las
 * issues 05/06/07 agregan Documentos/Asignaciones/Change Requests a este
 * mismo `slides` array, no como componentes aparte.
 *
 * @param {{
 *   project: object,
 *   onClose: () => void,
 *   onEdit: () => void,           // campos legacy (contrato, customer, etc.) — siempre disponible
 *   onEditSow?: () => void,       // SOW/Scope/Maintenance del wizard — solo si el proyecto tiene clientId
 * }} props
 */
export function ProjectDetailCarousel({ project, onClose, onEdit, onEditSow }) {
  const [history, setHistory] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [slideIndex, setSlideIndex] = useState(0)
  const dialogRef = useRef(null)
  // El keydown handler lee el índice actual acá en vez de por closure — así
  // el efecto que lo registra no necesita `slideIndex` en sus deps y no
  // hay que desuscribir/re-suscribir el listener global en cada navegación.
  const slideIndexRef = useRef(0)
  slideIndexRef.current = slideIndex

  const days = daysRemaining(project.contractExpirationDate)
  const status = contractStatus(days)

  const slides = [{ key: 'overview', label: 'Overview', content: <OverviewSlide project={project} /> }]
  const slide = slides[Math.min(slideIndex, slides.length - 1)]

  function goToSlide(i) {
    setSlideIndex((i + slides.length) % slides.length)
  }

  useEffect(() => {
    let cancelled = false
    setLoadingHistory(true)
    api.projects.getHistory(project.id)
      .then((rows) => !cancelled && setHistory(rows))
      .catch(() => !cancelled && setHistory([]))
      .finally(() => !cancelled && setLoadingHistory(false))
    return () => {
      cancelled = true
    }
  }, [project.id])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowLeft') goToSlide(slideIndexRef.current - 1)
      else if (event.key === 'ArrowRight') goToSlide(slideIndexRef.current + 1)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return (
    <motion.div
      className="modal-backdrop"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="modal modal--form modal--carousel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-carousel-title"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="modal__head">
          <div>
            <span className="modal__kicker">Projects and SOW · project detail</span>
            <h2 className="modal__title" id="project-carousel-title">
              {project.projectName}
            </h2>
          </div>
          <div className="modal__head-actions">
            {project.clientId && onEditSow && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={onEditSow}>
                <Settings2 size={15} strokeWidth={2.2} aria-hidden="true" />
                Edit SOW &amp; Scope
              </button>
            )}
            <button type="button" className="btn btn--ghost btn--sm" onClick={onEdit}>
              <Pencil size={15} strokeWidth={2.2} aria-hidden="true" />
              Edit
            </button>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="drawer__provider">
          <div className="drawer__provider-id">
            <span className="drawer__provider-name">{project.client}</span>
            <span className="drawer__provider-meta">
              {project.projectNumber}
              {project.contractExpirationDate ? ` · expires ${formatDate(project.contractExpirationDate)}` : ' · no contract'}
              {days != null && <> · {days < 0 ? `${Math.abs(days)} d overdue` : `${days} d`}</>}
            </span>
          </div>
          <ContractBadge status={status} />
        </div>

        <div className="carousel">
          <div className="carousel__head">
            <strong className="carousel__title">{slide.label}</strong>
            <span className="carousel__pos">
              {slideIndex + 1} / {slides.length}
            </span>
          </div>
          <div className="carousel__body">{slide.content}</div>
          <div className="carousel__nav">
            <button
              type="button"
              className="carousel__arrow"
              onClick={() => goToSlide(slideIndex - 1)}
              disabled={slides.length <= 1}
              aria-label="Previous section"
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <div className="carousel__dots" role="tablist" aria-label="Project detail sections">
              {slides.map((s, i) => (
                <button
                  key={s.key}
                  type="button"
                  role="tab"
                  aria-selected={i === slideIndex}
                  aria-label={s.label}
                  className={`carousel__dot${i === slideIndex ? ' is-active' : ''}`}
                  onClick={() => goToSlide(i)}
                />
              ))}
            </div>
            <button
              type="button"
              className="carousel__arrow"
              onClick={() => goToSlide(slideIndex + 1)}
              disabled={slides.length <= 1}
              aria-label="Next section"
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="drawer__section">
          <span className="drawer__section-label">Audit log</span>
          {loadingHistory ? (
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
      </motion.div>
    </motion.div>
  )
}
