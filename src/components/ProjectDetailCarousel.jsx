import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, ChevronLeft, ChevronRight, FileText, Pencil, Plus, Settings2, Upload, X } from 'lucide-react'
import { ContractBadge } from './ContractBadge'
import { contractStatus, daysRemaining } from '../lib/projectsData'
import { CR_TYPE_LABELS, effectiveBudgetHours } from '../lib/changeRequestsData'
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

function OverviewSlide({ project, stageCount, stageCountError, canEditSow, budgetHours, budgetExpanded }) {
  return (
    <dl className="drawer__facts">
      {OVERVIEW_FIELDS.map((field) => (
        <div className="drawer__fact" key={field.key}>
          <dt>{field.label}</dt>
          <dd>{project[field.key] || '—'}</dd>
        </div>
      ))}
      {project.baseBudgetHours != null && (
        <div className="drawer__fact">
          <dt>Budget Hours</dt>
          <dd>
            {budgetHours ?? project.baseBudgetHours} h
            {budgetExpanded && (
              <span className="field__hint"> (base {project.baseBudgetHours} + approved CRs)</span>
            )}
          </dd>
        </div>
      )}
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
      const separator = uploadTarget.indexOf(':')
      const subjectType = separator === -1 ? uploadTarget : uploadTarget.slice(0, separator)
      // Sin Number(): los ids de stage en modo demo son strings
      // ('stg-demo-…') y coercionarlos daría NaN.
      const subjectId = subjectType === 'msa' ? project.clientId : uploadTarget.slice(separator + 1)
      // Una sola llamada: sube al bucket que corresponde, actualiza el
      // puntero al documento vigente (si no, el resto de la app sigue
      // sirviendo el viejo) y versiona — con limpieza del archivo si falla.
      const { fileUrl, document } = await api.projects.uploadDocumentVersion({
        project,
        subjectType,
        subjectId,
        file: uploadFile,
        uploadedBy,
      })
      const label = uploadTargets.find((t) => t.value === uploadTarget)?.label ?? subjectType
      setDocuments((prev) => [
        {
          // La versión sale de la fila insertada. En demo no hay tabla, así
          // que se cuenta sobre lo que ya está en pantalla para ese subject
          // (si no, todas las subidas se mostrarían como v1).
          ...(document ?? {
            id: `demo-${Date.now()}`,
            subjectType,
            subjectId,
            fileUrl,
            version:
              prev.filter((d) => d.subjectType === subjectType && String(d.subjectId) === String(subjectId)).length + 1,
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
      // El mensaje crudo de PostgREST/Storage no le dice nada al usuario
      // (queda en consola); en pantalla, algo accionable.
      console.error('No se pudo subir el documento:', error)
      setUploadError(
        error?.code === 'bad_type' || error?.code === 'too_big'
          ? error.message // validaciones nuestras, ya están redactadas para el usuario
          : 'Could not upload the document — please try again.',
      )
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
 * ok / exhausted / exceeded según lo que queda de la autorización. Usa las
 * clases badge--* reales de la app (mismo vocabulario que ContractBadge),
 * no las `pill` del mockup, que no existen en index.css.
 */
function assignmentStatus(remainingHours) {
  if (remainingHours > 0) return { label: 'ok', cls: 'badge--ok' }
  if (remainingHours === 0) return { label: 'exhausted', cls: 'badge--pending' }
  return { label: 'exceeded · overage', cls: 'badge--no' }
}

/**
 * Slide Asignaciones (issue 06): horas autorizadas por proveedor/task.
 * Consumed/Remaining los calcula assignmentsData contra time_entries (no se
 * guardan). Proveedor y task salen de listas cerradas — un typo generaría
 * una asignación que nunca matchearía con sus horas.
 */
function AssignmentsSlide({ project, createdBy, canEdit }) {
  const [assignments, setAssignments] = useState([])
  const [providers, setProviders] = useState([])
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ providerName: '', taskName: '', authorizedHours: '' })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(false)
    // allSettled sobre las tres: que falle el catálogo de proveedores/tasks
    // (solo alimenta el alta) no debería impedir ver las asignaciones que ya
    // existen, que es lo principal de este slide.
    Promise.allSettled([
      Promise.resolve().then(() => api.assignments.list(project)),
      Promise.resolve().then(() => api.assignments.providerNames()),
      Promise.resolve().then(() => api.projectTasks.list(project.id)),
    ])
      .then(([assignmentsResult, providersResult, tasksResult]) => {
        if (cancelled) return
        if (assignmentsResult.status === 'fulfilled') setAssignments(assignmentsResult.value)
        else {
          console.error('No se pudieron cargar las asignaciones:', assignmentsResult.reason)
          setLoadError(true)
        }
        if (providersResult.status === 'fulfilled') setProviders(providersResult.value)
        else console.error('No se pudo cargar la lista de proveedores:', providersResult.reason)
        if (tasksResult.status === 'fulfilled') setTasks(tasksResult.value)
        else console.error('No se pudieron cargar las tasks del proyecto:', tasksResult.reason)
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [project])

  const hoursValid = Number(form.authorizedHours) > 0
  const canSubmit = form.providerName && form.taskName && hoursValid && !saving

  async function handleCreate() {
    if (!canSubmit) return
    setSaving(true)
    setSaveError('')
    try {
      const created = await api.assignments.create(
        {
          projectId: project.id,
          providerName: form.providerName,
          taskName: form.taskName,
          authorizedHours: Number(form.authorizedHours),
        },
        createdBy,
      )
      // createAssignment no devuelve consumed/remaining (los calcula
      // getAssignments contra time_entries) — para una asignación recién
      // creada, lo consumido es lo que ya haya cargado ese proveedor en esa
      // task, que acá no conocemos. Se recalcula al reabrir el slide; por
      // ahora se muestra la autorización completa como restante.
      setAssignments((prev) => [
        { ...created, consumedHours: created.consumedHours ?? 0, remainingHours: created.authorizedHours },
        ...prev,
      ])
      setForm({ providerName: '', taskName: '', authorizedHours: '' })
      setShowForm(false)
    } catch (error) {
      setSaveError(error?.message ?? 'Could not save the assignment.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="drawer__empty">Loading assignments…</p>
  if (loadError) return <p className="drawer__empty">Assignments could not be loaded — try reopening this project.</p>

  return (
    <div>
      {assignments.length === 0 && !showForm ? (
        <div className="carousel__empty">
          <p>No providers assigned yet.</p>
          {canEdit && (
            <button type="button" className="btn btn--pay btn--sm" onClick={() => setShowForm(true)}>
              <Plus size={14} aria-hidden="true" /> Assign provider
            </button>
          )}
        </div>
      ) : (
        assignments.length > 0 && (
          <div className="table-wrap">
            <table className="table table--form">
              <thead>
                <tr>
                  <th scope="col">Provider</th>
                  <th scope="col">Task</th>
                  <th scope="col" className="col-num">Authorized</th>
                  <th scope="col" className="col-num">Consumed</th>
                  <th scope="col" className="col-num">Remaining</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((a) => {
                  const st = assignmentStatus(a.remainingHours)
                  return (
                    <tr key={a.id}>
                      <td>{a.providerName}</td>
                      <td className="cell-soft">{a.taskName}</td>
                      <td className="col-num">{a.authorizedHours}</td>
                      <td className="col-num">{a.consumedHours}</td>
                      <td className="col-num">{a.remainingHours}</td>
                      <td>
                        <span className={`badge ${st.cls}`}>{st.label}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {showForm ? (
        <div className="field-grid" style={{ marginTop: 12 }}>
          <div className="field">
            <label className="field__label" htmlFor="assign-provider">Provider</label>
            <select
              id="assign-provider"
              className="field__input"
              value={form.providerName}
              onChange={(e) => setForm((p) => ({ ...p, providerName: e.target.value }))}
            >
              <option value="">Select…</option>
              {providers.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            {providers.length === 0 && <span className="field__hint">No providers with logged hours yet.</span>}
          </div>
          <div className="field">
            <label className="field__label" htmlFor="assign-task">Task</label>
            <select
              id="assign-task"
              className="field__input"
              value={form.taskName}
              onChange={(e) => setForm((p) => ({ ...p, taskName: e.target.value }))}
            >
              <option value="">Select…</option>
              {tasks.map((t) => (
                <option key={t.id} value={t.taskName}>{t.taskName}</option>
              ))}
            </select>
            {tasks.length === 0 && (
              <span className="field__hint">This project has no SOW tasks yet — add them from "Edit SOW &amp; Scope".</span>
            )}
          </div>
          <div className="field">
            <label className="field__label" htmlFor="assign-hours">Authorized Hours</label>
            <input
              id="assign-hours"
              type="number"
              min="0"
              step="0.5"
              className="field__input"
              value={form.authorizedHours}
              onChange={(e) => setForm((p) => ({ ...p, authorizedHours: e.target.value }))}
            />
          </div>
          {saveError && <span className="field__error">{saveError}</span>}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button type="button" className="btn btn--pay btn--sm" onClick={handleCreate} disabled={!canSubmit}>
              {saving ? 'Saving…' : 'Assign'}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        canEdit &&
        assignments.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowForm(true)}>
              <Plus size={14} aria-hidden="true" /> Assign provider
            </button>
          </div>
        )
      )}
    </div>
  )
}

const CR_STATUS_CLS = { approved: 'badge--ok', rejected: 'badge--no', pending: 'badge--pending' }

/**
 * Slide Change Requests (issue 07): ajustes al presupuesto pactado después
 * de firmado el SOW. Crear lo puede Operations; aprobar/rechazar es
 * exclusivo de Administrator (mueve plata acordada con el cliente).
 *
 * Los CRs se cargan en el componente padre, no acá — el presupuesto vigente
 * que derivan también lo muestra el slide Overview.
 */
function ChangeRequestsSlide({
  changeRequests,
  loading,
  loadError,
  canCreate,
  canDecide,
  onCreate,
  onDecide,
}) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ type: 'expand_budget', deltaHours: '', reason: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [decidingId, setDecidingId] = useState(null)

  const deltaValid = Number.isFinite(Number(form.deltaHours)) && String(form.deltaHours).trim() !== ''
  const canSubmit = deltaValid && form.reason.trim() && !saving

  async function handleCreate() {
    if (!canSubmit) return
    setSaving(true)
    setError('')
    try {
      await onCreate({ type: form.type, deltaHours: Number(form.deltaHours), reason: form.reason.trim() })
      setForm({ type: 'expand_budget', deltaHours: '', reason: '' })
      setShowForm(false)
    } catch (err) {
      setError(err?.message ?? 'Could not create the change request.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDecide(cr, decision) {
    setDecidingId(cr.id)
    setError('')
    try {
      await onDecide(cr, decision)
    } catch (err) {
      setError(err?.message ?? 'Could not save the decision.')
    } finally {
      setDecidingId(null)
    }
  }

  if (loading) return <p className="drawer__empty">Loading change requests…</p>
  if (loadError) return <p className="drawer__empty">Change requests could not be loaded — try reopening this project.</p>

  return (
    <div>
      {changeRequests.length === 0 && !showForm ? (
        <div className="carousel__empty">
          <p>No change requests yet.</p>
          {canCreate && (
            <button type="button" className="btn btn--pay btn--sm" onClick={() => setShowForm(true)}>
              <Plus size={14} aria-hidden="true" /> New Change Request
            </button>
          )}
        </div>
      ) : (
        changeRequests.length > 0 && (
          <div className="table-wrap">
            <table className="table table--form">
              <thead>
                <tr>
                  <th scope="col">CR</th>
                  <th scope="col">Type</th>
                  <th scope="col" className="col-num">Δ Hours</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Requested by</th>
                  <th scope="col">Status</th>
                  {canDecide && <th scope="col" aria-label="Decision" />}
                </tr>
              </thead>
              <tbody>
                {changeRequests.map((cr) => (
                  <tr key={cr.id}>
                    <td className="cell-mono">{cr.crNumber}</td>
                    <td>{CR_TYPE_LABELS[cr.type] ?? cr.type}</td>
                    <td className="col-num">
                      {cr.deltaHours > 0 ? '+' : ''}
                      {cr.deltaHours}
                    </td>
                    <td className="cell-soft">{cr.reason || '—'}</td>
                    <td className="cell-soft">{cr.requestedBy || '—'}</td>
                    <td>
                      <span className={`badge ${CR_STATUS_CLS[cr.status] ?? 'badge--pending'}`}>{cr.status}</span>
                      {cr.status !== 'pending' && cr.decidedBy && (
                        <span className="field__hint"> {cr.decidedBy}</span>
                      )}
                    </td>
                    {canDecide && (
                      <td>
                        {cr.status === 'pending' && (
                          <span style={{ display: 'flex', gap: 6 }}>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              onClick={() => handleDecide(cr, 'approve')}
                              disabled={decidingId === cr.id}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              onClick={() => handleDecide(cr, 'reject')}
                              disabled={decidingId === cr.id}
                            >
                              Reject
                            </button>
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
      {error && <p className="field__error">{error}</p>}

      {showForm ? (
        <div className="field-grid" style={{ marginTop: 12 }}>
          <div className="field">
            <label className="field__label" htmlFor="cr-type">Type</label>
            <select
              id="cr-type"
              className="field__input"
              value={form.type}
              onChange={(e) => setForm((p) => ({ ...p, type: e.target.value }))}
            >
              {Object.entries(CR_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="cr-delta">
              Δ Hours
              <span className="field__hint">negative to reduce</span>
            </label>
            <input
              id="cr-delta"
              type="number"
              step="0.5"
              className="field__input"
              value={form.deltaHours}
              onChange={(e) => setForm((p) => ({ ...p, deltaHours: e.target.value }))}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="cr-reason">Reason</label>
            <input
              id="cr-reason"
              className="field__input"
              value={form.reason}
              onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
              autoComplete="off"
            />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button type="button" className="btn btn--pay btn--sm" onClick={handleCreate} disabled={!canSubmit}>
              {saving ? 'Saving…' : 'Create change request'}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        canCreate &&
        changeRequests.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowForm(true)}>
              <Plus size={14} aria-hidden="true" /> New Change Request
            </button>
          </div>
        )
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
 *   canEditAssignments?: boolean, // permiso assignments.edit (issue 06)
 *   canCreateChangeRequests?: boolean, // permiso changeRequests.create (issue 07)
 *   canDecideChangeRequests?: boolean, // permiso changeRequests.decide (issue 07)
 *   onClose: () => void,
 *   onEdit: () => void,           // campos legacy (contrato, customer, etc.) — siempre disponible
 *   onEditSow?: () => void,       // SOW/Scope/Maintenance del wizard — solo si el proyecto tiene clientId
 * }} props
 */
export function ProjectDetailCarousel({
  project,
  uploadedBy,
  canEditAssignments,
  canCreateChangeRequests,
  canDecideChangeRequests,
  onClose,
  onEdit,
  onEditSow,
}) {
  const [history, setHistory] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [stageCount, setStageCount] = useState(null)
  const [stageCountError, setStageCountError] = useState(false)
  const [changeRequests, setChangeRequests] = useState([])
  const [loadingCrs, setLoadingCrs] = useState(true)
  const [crsLoadError, setCrsLoadError] = useState(false)
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
  const budgetHours = effectiveBudgetHours(project.baseBudgetHours, changeRequests)
  const budgetExpanded = budgetHours != null && budgetHours !== Number(project.baseBudgetHours)

  async function handleCreateChangeRequest(payload) {
    const created = await api.changeRequests.create({ ...payload, projectId: project.id }, uploadedBy)
    setChangeRequests((prev) => [...prev, created])
  }

  async function handleDecideChangeRequest(cr, decision) {
    const updated =
      decision === 'approve'
        ? await api.changeRequests.approve(cr.id, uploadedBy)
        : await api.changeRequests.reject(cr.id, uploadedBy)
    setChangeRequests((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
  }

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
          budgetHours={budgetHours}
          budgetExpanded={budgetExpanded}
        />
      ),
    },
    {
      key: 'documents',
      label: 'Documentos',
      content: <DocumentsSlide project={project} uploadedBy={uploadedBy} />,
    },
    {
      key: 'assignments',
      label: 'Asignaciones',
      content: <AssignmentsSlide project={project} createdBy={uploadedBy} canEdit={canEditAssignments} />,
    },
    {
      key: 'change-requests',
      label: 'Change Requests',
      content: (
        <ChangeRequestsSlide
          changeRequests={changeRequests}
          loading={loadingCrs}
          loadError={crsLoadError}
          canCreate={canCreateChangeRequests}
          canDecide={canDecideChangeRequests}
          onCreate={handleCreateChangeRequest}
          onDecide={handleDecideChangeRequest}
        />
      ),
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
    let cancelled = false
    setLoadingCrs(true)
    setCrsLoadError(false)
    Promise.resolve()
      .then(() => api.changeRequests.list(project.id))
      .then((rows) => !cancelled && setChangeRequests(rows))
      .catch((error) => {
        if (cancelled) return
        console.error('No se pudieron cargar los change requests:', error)
        setCrsLoadError(true)
      })
      .finally(() => !cancelled && setLoadingCrs(false))
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
