import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, ChevronLeft, ChevronRight, FileText, Pencil, Settings2, Upload, X } from 'lucide-react'
import { ContractBadge } from './ContractBadge'
import { contractStatus, daysRemaining } from '../lib/projectsData'
import { api } from '../lib/api'
import { fileNameFromPath, formatDate, formatDateTime } from '../lib/format'

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

function OverviewSlide({ project, stageCount, stageCountError, canEditSow }) {
  return (
    <dl className="drawer__facts">
      {OVERVIEW_FIELDS.map((field) => (
        <div className="drawer__fact" key={field.key}>
          <dt>{field.label}</dt>
          <dd>{project[field.key] || '—'}</dd>
        </div>
      ))}
      {project.hasStages && (
        <div className="drawer__fact">
          <dt>Stages</dt>
          <dd>
            {stageCountError ? (
              'Could not load — try reopening this project.'
            ) : stageCount == null ? (
              'Loading…'
            ) : (
              <>
                {stageCount} stage{stageCount === 1 ? '' : 's'}
                {canEditSow && ' — see "Edit SOW & Scope" for the full breakdown'}
              </>
            )}
          </dd>
        </div>
      )}
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
 * Slide Documentos (issue 05): historial versionado de MSA/SOW/CR-annex
 * relevantes a este proyecto. Ver/Subir se ramifican por subjectType porque
 * el MSA vive en el bucket 'client-msa' (api.clients.*) y SOW/CR en
 * 'project-documents' (api.projects.*) — son buckets de Storage distintos.
 */
function DocumentsSlide({ project, uploadedBy }) {
  const [documents, setDocuments] = useState([])
  const [stages, setStages] = useState([])
  const [changeRequests, setChangeRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [viewingId, setViewingId] = useState(null)
  const [viewMsg, setViewMsg] = useState('')
  const [uploadTarget, setUploadTarget] = useState('')
  const [uploadFile, setUploadFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [showUploadForm, setShowUploadForm] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(false)
    // Promise.resolve().then(...): mismo motivo que el fetch de stages en
    // Overview — absorbe un throw síncrono del backend (ej. un stub
    // incompleto) en el .catch de acá abajo.
    Promise.resolve()
      .then(() => api.projects.getDocuments(project))
      .then((result) => {
        if (cancelled) return
        setDocuments(result.documents)
        setStages(result.stages)
        setChangeRequests(result.changeRequests)
      })
      .catch((error) => {
        if (cancelled) return
        console.error('No se pudieron cargar los documentos del proyecto:', error)
        setLoadError(true)
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [project])

  const uploadTargets = []
  if (project.clientId) {
    uploadTargets.push({ value: 'msa', label: `${project.client || 'Client'} · MSA` })
  }
  if (project.hasStages) {
    stages.forEach((s) => uploadTargets.push({ value: `sow:${s.id}`, label: `${s.stageName} · SOW` }))
  } else {
    uploadTargets.push({ value: `sow:${project.id}`, label: 'This project · SOW' })
  }
  changeRequests.forEach((cr) => uploadTargets.push({ value: `change_request:${cr.id}`, label: `${cr.crNumber} · annex` }))

  async function handleView(doc) {
    setViewMsg('')
    setViewingId(doc.id)
    try {
      const url =
        doc.subjectType === 'msa'
          ? await api.clients.getMsaUrl(doc.fileUrl)
          : await api.projects.getDocumentUrl(doc.fileUrl)
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
      else setViewMsg(doc.fileUrl.startsWith('demo/') ? 'Demo mode: this document cannot be downloaded.' : 'Could not generate the download link.')
    } catch (error) {
      // Sin este catch, un backend que tira (en vez de devolver null) deja
      // el error como unhandled rejection y el usuario no ve nada.
      console.error('No se pudo abrir el documento:', error)
      setViewMsg('Could not generate the download link.')
    } finally {
      setViewingId(null)
    }
  }

  async function handleUpload() {
    if (!uploadFile || !uploadTarget) return
    setUploading(true)
    setUploadError('')
    try {
      const [subjectType, subjectIdRaw] = uploadTarget.split(':')
      const subjectId = subjectType === 'msa' ? project.clientId : Number(subjectIdRaw)
      // Solo la subida ramifica por bucket (el MSA vive en 'client-msa', el
      // resto en 'project-documents'); el registro de la versión es la misma
      // tabla para los tres tipos.
      const fileUrl =
        subjectType === 'msa' ? await api.clients.uploadMsa(uploadFile) : await api.projects.uploadSowFile(uploadFile)
      // Strict, no la variante best-effort: acá subir el documento ES la
      // acción del usuario, así que un fallo al registrarlo tiene que
      // avisarse, no dejar una fila fantasma que desaparece al recargar.
      const created = await api.projects.recordDocumentStrict({ subjectType, subjectId, fileUrl, uploadedBy })
      const label = uploadTargets.find((t) => t.value === uploadTarget)?.label ?? subjectType
      setDocuments((prev) => [
        {
          // La versión sale de la fila que devolvió el insert, no de una
          // cuenta local — dos usuarios subiendo a la vez la calcularían
          // igual y uno mostraría un número que no es el suyo.
          ...(created ?? {
            id: `demo-${Date.now()}`,
            subjectType,
            subjectId,
            fileUrl,
            version: 1,
            uploadedAt: new Date().toISOString(),
            uploadedBy,
          }),
          linkedToLabel: label,
        },
        ...prev,
      ])
      setUploadFile(null)
      setUploadTarget('')
      setShowUploadForm(false)
    } catch (error) {
      setUploadError(error?.message ?? 'Could not upload.')
    } finally {
      setUploading(false)
    }
  }

  if (loading) return <p className="drawer__empty">Loading documents…</p>
  if (loadError) return <p className="drawer__empty">Documents could not be loaded — try reopening this project.</p>

  return (
    <div>
      {documents.length === 0 ? (
        <div className="carousel__empty">
          <p>No documents recorded yet.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table table--form">
            <thead>
              <tr>
                <th scope="col">Document</th>
                <th scope="col">Linked to</th>
                <th scope="col">Version</th>
                <th scope="col">Uploaded</th>
                <th scope="col" aria-label="View" />
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id}>
                  <td>
                    <FileText size={13} aria-hidden="true" /> {fileNameFromPath(doc.fileUrl)}
                  </td>
                  <td className="cell-soft">{doc.linkedToLabel}</td>
                  <td className="cell-mono">v{doc.version}</td>
                  <td className="cell-soft">
                    {formatDateTime(doc.uploadedAt)}
                    {doc.uploadedBy ? ` · ${doc.uploadedBy}` : ''}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => handleView(doc)}
                      disabled={viewingId === doc.id}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {viewMsg && <p className="field__error">{viewMsg}</p>}

      {showUploadForm ? (
        <div className="field-grid" style={{ marginTop: 12 }}>
          <div className="field">
            <label className="field__label" htmlFor="doc-upload-target">
              Attach to
            </label>
            <select
              id="doc-upload-target"
              className="field__input"
              value={uploadTarget}
              onChange={(e) => setUploadTarget(e.target.value)}
            >
              <option value="">Select…</option>
              {uploadTargets.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="doc-upload-file">
              File
            </label>
            <input
              id="doc-upload-file"
              type="file"
              accept=".docx,application/pdf,.pdf"
              className="field__input field__input--file"
              onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
            />
            {uploadFile && <span className="field__filename">{uploadFile.name}</span>}
          </div>
          {uploadError && <span className="field__error">{uploadError}</span>}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              type="button"
              className="btn btn--pay btn--sm"
              onClick={handleUpload}
              disabled={!uploadFile || !uploadTarget || uploading}
            >
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowUploadForm(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowUploadForm(true)}>
            <Upload size={14} aria-hidden="true" /> Upload document
          </button>
        </div>
      )}
    </div>
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
 *   uploadedBy: ?string,          // email del usuario actual — para versionar documentos (issue 05)
 *   onClose: () => void,
 *   onEdit: () => void,           // campos legacy (contrato, customer, etc.) — siempre disponible
 *   onEditSow?: () => void,       // SOW/Scope/Maintenance del wizard — solo si el proyecto tiene clientId
 * }} props
 */
export function ProjectDetailCarousel({ project, uploadedBy, onClose, onEdit, onEditSow }) {
  const [history, setHistory] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [stageCount, setStageCount] = useState(null)
  const [stageCountError, setStageCountError] = useState(false)
  const [slideIndex, setSlideIndex] = useState(0)
  const dialogRef = useRef(null)
  // El keydown handler lee el índice actual acá en vez de por closure — así
  // el efecto que lo registra no necesita `slideIndex` en sus deps y no
  // hay que desuscribir/re-suscribir el listener global en cada navegación.
  const slideIndexRef = useRef(0)
  slideIndexRef.current = slideIndex

  const days = daysRemaining(project.contractExpirationDate)
  const status = contractStatus(days)
  // Mismo gate que el botón "Edit SOW & Scope" de acá abajo — el texto del
  // slide Overview que lo referencia solo debe aparecer cuando el botón
  // realmente se va a renderizar (clientId puede ser null incluso con
  // hasStages=true).
  const canEditSow = Boolean(project.clientId && onEditSow)

  const slides = [
    {
      key: 'overview',
      label: 'Overview',
      content: (
        <OverviewSlide
          project={project}
          stageCount={stageCount}
          stageCountError={stageCountError}
          canEditSow={canEditSow}
        />
      ),
    },
    {
      key: 'documents',
      label: 'Documentos',
      content: <DocumentsSlide project={project} uploadedBy={uploadedBy} />,
    },
  ]
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
    if (!project.hasStages) return
    let cancelled = false
    setStageCountError(false)
    // Promise.resolve().then(...) en vez de llamar getStages directo:
    // absorbe un throw síncrono (el stub de http-client.js tira en vez de
    // rechazar una promise) en el mismo .catch de abajo, no como una
    // excepción sin capturar que tumbaría el efecto entero.
    Promise.resolve()
      .then(() => api.projects.getStages(project.id))
      .then((stages) => !cancelled && setStageCount(stages.length))
      .catch((error) => {
        if (cancelled) return
        console.error('No se pudo cargar la cantidad de stages del proyecto:', error)
        setStageCountError(true)
      })
    return () => {
      cancelled = true
    }
  }, [project.id, project.hasStages])

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
            {canEditSow && (
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
