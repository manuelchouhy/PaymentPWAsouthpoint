import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronDown, ChevronLeft, ChevronRight, FileText, Pencil, Plus, Settings2, Upload, X } from 'lucide-react'
import { ContractBadge } from './ContractBadge'
import { contractStatus, daysRemaining } from '../lib/projectsData'
import { CR_TYPE_LABELS, effectiveBudgetHours } from '../lib/changeRequestsData'
import { buildProjectTaskTree } from '../lib/projectTaskTree'
import { mergeProjectTasks } from '../lib/mergeProjectTasks'
import { api } from '../lib/api'
import { fileNameFromPath, formatDate, formatDateTime } from '../lib/format'
import { useScrollLock } from '../lib/useScrollLock'

// El resto de la ficha —lo que trae el sync de Zoho y los datos de contrato—
// baja a un bloque desplegable dentro del mismo slide. No se elimina: se saca
// del golpe de vista para que el SOW no quede sepultado entre 14 campos.
const RECORD_FIELDS = [
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

function OverviewSlide({
  project,
  stageCount,
  stageCountError,
  canEditSow,
  budgetHours,
  budgetExpanded,
  budgetPending,
  budgetError,
}) {
  const period =
    project.periodStart || project.periodEnd
      ? `${project.periodStart ? formatDate(project.periodStart) : '—'} → ${
          project.periodEnd ? formatDate(project.periodEnd) : '—'
        }`
      : '—'

  return (
    <>
    <dl className="drawer__facts">
      <div className="drawer__fact">
        <dt>Client</dt>
        <dd>{project.client || '—'}</dd>
      </div>
      <div className="drawer__fact">
        <dt>SOW Status</dt>
        <dd>
          {project.zohoStatus ? (
            <span className="badge badge--ok">{project.zohoStatus}</span>
          ) : (
            '—'
          )}
        </dd>
      </div>
      <div className="drawer__fact">
        <dt>Project</dt>
        <dd>{project.projectName || '—'}</dd>
      </div>
      <div className="drawer__fact">
        <dt>SOW Number</dt>
        <dd className="cell-mono">{project.sowNumber || '—'}</dd>
      </div>
      {project.baseBudgetHours != null && (
        <div className="drawer__fact">
          <dt>Budget Hours</dt>
          <dd>
            {/* Sin los change requests cargados no se sabe el presupuesto
                vigente — mostrar la base como si lo fuera haría que
                Operations subestime lo que el cliente ya aprobó. */}
            {budgetError ? (
              `${project.baseBudgetHours} h (base — approved CRs could not be loaded)`
            ) : budgetPending ? (
              'Loading…'
            ) : (
              <>
                {budgetHours ?? project.baseBudgetHours} h
                {budgetExpanded && (
                  <span className="field__hint"> (base {project.baseBudgetHours} + approved CRs)</span>
                )}
              </>
            )}
          </dd>
        </div>
      )}
      <div className="drawer__fact">
        <dt>Model</dt>
        <dd>{project.model || '—'}</dd>
      </div>
      <div className="drawer__fact">
        <dt>Period</dt>
        <dd>{period}</dd>
      </div>
      <div className="drawer__fact">
        <dt>Stage</dt>
        <dd>
          {!project.hasStages ? (
            project.stageName || '—'
          ) : stageCountError ? (
            'Could not load — try reopening this project.'
          ) : stageCount == null ? (
            'Loading…'
          ) : (
            <>
              {stageCount} stage{stageCount === 1 ? '' : 's'}
              {canEditSow && ' — see "Edit SOW & Scope"'}
            </>
          )}
        </dd>
      </div>
    </dl>

    {/* Ficha administrativa: los campos que trae el sync de Zoho más los del
        contrato. Van desplegados aparte para que el slide 1 quede como el mock
        —ocho campos del SOW— sin perder información que ya se mostraba. */}
    <details className="proj-record">
      <summary>Project record</summary>
      <dl className="drawer__facts">
        {RECORD_FIELDS.map((field) => (
          <div className="drawer__fact" key={field.key}>
            <dt>{field.label}</dt>
            <dd>{project[field.key] || '—'}</dd>
          </div>
        ))}
        <div className="drawer__fact">
          <dt>Contract Expiration</dt>
          <dd>{project.contractExpirationDate ? formatDate(project.contractExpirationDate) : '—'}</dd>
        </div>
      </dl>
    </details>
    </>
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
  // Tolerancia en vez de === 0: remaining es una resta de sumas de floats
  // (8.1 + 8.1 + 8.1 contra 24.3 deja 3.55e-15), que compararía "ok" cuando
  // en realidad está agotada.
  const EPSILON = 0.001
  if (remainingHours > EPSILON) return { label: 'ok', cls: 'badge--ok' }
  if (remainingHours >= -EPSILON) return { label: 'exhausted', cls: 'badge--pending' }
  return { label: 'exceeded · overage', cls: 'badge--no' }
}

/** Horas legibles: sin decimales de ruido binario ni ceros al pedo. */
function formatHours(hours) {
  return Number(Number(hours).toFixed(2)).toString()
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
  const [tasksFromSow, setTasksFromSow] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [catalogError, setCatalogError] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ providerName: '', taskName: '', authorizedHours: '' })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  async function loadAssignments() {
    const rows = await api.assignments.list(project)
    setAssignments(rows)
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(false)
    setCatalogError(false)
    // allSettled sobre las tres: que falle el catálogo de proveedores/tasks
    // (solo alimenta el alta) no debería impedir ver las asignaciones que ya
    // existen, que es lo principal de este slide.
    Promise.allSettled([
      Promise.resolve().then(() => api.assignments.list(project)),
      Promise.resolve().then(() => api.assignments.providerNames()),
      Promise.resolve().then(async () => {
        const logged = await api.assignments.taskNames(project.projectName)
        // Si el proyecto todavía no tiene horas aprobadas no hay texto de Zoho
        // que ofrecer, y sin opciones no se puede autorizar a nadie — que es
        // lo que uno hace justamente ANTES de que carguen la primera hora.
        // En ese caso se cae a las tasks del SOW; en cuanto haya horas, manda
        // el texto real (que es el que matchea al calcular lo consumido).
        if (logged.length) return { names: logged, fromSow: false }
        const sowTasks = await api.projectTasks.list(project.id)
        return { names: sowTasks.map((t) => t.taskName), fromSow: true }
      }),
    ])
      .then(([assignmentsResult, providersResult, tasksResult]) => {
        if (cancelled) return
        if (assignmentsResult.status === 'fulfilled') setAssignments(assignmentsResult.value)
        else {
          console.error('No se pudieron cargar las asignaciones:', assignmentsResult.reason)
          setLoadError(true)
        }
        // Un catálogo que falló NO es un catálogo vacío: sin esta distinción
        // el form diría "este proyecto no tiene tasks" y mandaría al usuario
        // a crear tasks que ya existen.
        if (providersResult.status === 'fulfilled') setProviders(providersResult.value)
        else {
          console.error('No se pudo cargar la lista de proveedores:', providersResult.reason)
          setCatalogError(true)
        }
        if (tasksResult.status === 'fulfilled') {
          setTasks(tasksResult.value.names)
          setTasksFromSow(tasksResult.value.fromSow)
        } else {
          console.error('No se pudieron cargar los task de las horas cargadas:', tasksResult.reason)
          setCatalogError(true)
        }
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [project])

  const hoursValid = Number(form.authorizedHours) > 0
  const canSubmit = form.providerName && form.taskName && hoursValid && !saving
  // El índice único (project_id, task_name, provider_name) de 0019 rechaza un
  // duplicado, así que si el par ya existe esto es una ampliación de la
  // autorización, no un alta — es el único camino a updateAssignmentHours.
  const existing = assignments.find(
    (a) => a.providerName === form.providerName && a.taskName === form.taskName,
  )

  async function handleSubmit() {
    if (!canSubmit) return
    setSaving(true)
    setSaveError('')
    try {
      if (existing) {
        await api.assignments.updateHours(existing.id, Number(form.authorizedHours), createdBy)
      } else {
        await api.assignments.create(
          {
            projectId: project.id,
            providerName: form.providerName,
            taskName: form.taskName,
            authorizedHours: Number(form.authorizedHours),
          },
          createdBy,
        )
      }
      // Se recarga en vez de insertar una fila optimista: consumed/remaining
      // los calcula getAssignments contra time_entries, y un proveedor puede
      // tener horas cargadas de antes de formalizar la autorización —
      // mostrar "consumed 0 / ok" ahí sería mentirle al PM justo cuando está
      // decidiendo cuántas horas autorizar.
      await loadAssignments()
      setForm({ providerName: '', taskName: '', authorizedHours: '' })
      setShowForm(false)
    } catch (error) {
      console.error('No se pudo guardar la asignación:', error)
      setSaveError('Could not save the assignment — please try again.')
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
                      <td className="col-num">{formatHours(a.authorizedHours)}</td>
                      <td className="col-num">{formatHours(a.consumedHours)}</td>
                      <td className="col-num">{formatHours(a.remainingHours)}</td>
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
            {providers.length === 0 && !catalogError && (
              <span className="field__hint">No providers with logged hours yet.</span>
            )}
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
              {tasks.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            {tasksFromSow && tasks.length > 0 && (
              <span className="field__hint">
                From the SOW — no approved hours logged yet, so consumed will stay 0 until the task
                text logged in Zoho matches.
              </span>
            )}
            {tasks.length === 0 && !catalogError && (
              <span className="field__hint">No tasks to assign against yet.</span>
            )}
            {catalogError && (
              <span className="field__error">
                The provider/task lists could not be loaded — try reopening this project.
              </span>
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
          {existing && (
            <span className="field__hint">
              {existing.providerName} is already assigned to {existing.taskName} for{' '}
              {formatHours(existing.authorizedHours)} h — saving replaces that authorization.
            </span>
          )}
          {saveError && <span className="field__error">{saveError}</span>}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button type="button" className="btn btn--pay btn--sm" onClick={handleSubmit} disabled={!canSubmit}>
              {saving ? 'Saving…' : existing ? 'Update authorized hours' : 'Assign'}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                setSaveError('')
                setShowForm(false)
              }}
            >
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

  // Un expand_budget con delta 0 no cambia nada y ensucia el historial; los
  // otros tipos registran el hecho (un write-off, una nota de alcance) y su
  // delta es informativo, así que 0 es legítimo ahí.
  const deltaNumber = Number(form.deltaHours)
  const deltaValid =
    String(form.deltaHours).trim() !== '' &&
    Number.isFinite(deltaNumber) &&
    (form.type !== 'expand_budget' || deltaNumber !== 0)
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
              <span className="field__hint">
                {form.type === 'expand_budget'
                  ? 'negative to reduce'
                  : 'recorded only — does not change the budget'}
              </span>
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
 * Slide "Stages & Tasks" (slice 12, lote WhatsApp 2026-09-10): vista de árbol de los
 * stages del proyecto y sus tasks. El agrupado lo hace `buildProjectTaskTree` (módulo puro);
 * acá solo se renderiza. Cada nodo es expandible; un click en el header abre/cierra su lista.
 * Los tasks son el merge de los registrados del SOW (con su stage) y los logueados de las
 * horas (mergeProjectTasks): cada uno cae bajo su stage, o bajo "No stage" si no está asignado.
 */
function StagesTasksSlide({ tree, loading, error, stagesError, expanded, onToggle }) {
  if (loading) return <p className="drawer__empty">Loading stages & tasks…</p>
  // error = falló la carga de tasks: sin tasks no hay árbol que mostrar.
  if (error)
    return (
      <p className="drawer__empty">Stages & tasks could not be loaded — try reopening this project.</p>
    )
  // Nada que mostrar. Los tasks cargaron OK (si no, `error` de arriba): la lista
  // está genuinamente vacía. Si además fallaron los stages, lo aclaramos — así no
  // se lee como "proyecto sin stages" cuando en realidad no se pudieron cargar.
  if (tree.length === 0)
    return (
      <p className="drawer__empty">
        {stagesError
          ? 'No tasks yet, and stages could not be loaded — try reopening this project.'
          : 'This project has no stages or tasks yet.'}
      </p>
    )

  return (
    <>
      {/* Fallo solo de stages con tasks disponibles: se muestran igual, ungrouped. */}
      {stagesError && (
        <p className="stage-tree__warn">
          Stages could not be loaded — tasks are shown ungrouped.
        </p>
      )}
      <ul className="stage-tree">
      {tree.map((node) => {
        const isOpen = expanded.has(node.key)
        return (
          <li key={node.key} className="stage-tree__node">
            <button
              type="button"
              className="stage-tree__header"
              aria-expanded={isOpen}
              onClick={() => onToggle(node.key)}
            >
              {isOpen ? (
                <ChevronDown size={15} aria-hidden="true" />
              ) : (
                <ChevronRight size={15} aria-hidden="true" />
              )}
              <span className="stage-tree__label">{node.label}</span>
              <span className="stage-tree__count">
                {node.tasks.length} {node.tasks.length === 1 ? 'task' : 'tasks'}
              </span>
            </button>
            {isOpen &&
              (node.tasks.length === 0 ? (
                <p className="stage-tree__empty">No tasks in this stage.</p>
              ) : (
                <ul className="stage-tree__tasks">
                  {node.tasks.map((t, i) => (
                    // taskId (id de project_tasks) es único; el nombre NO (el merge conserva
                    // project_tasks distintos con el mismo nombre). Fallback a nombre+idx.
                    <li
                      key={t.taskId != null ? `id-${t.taskId}` : `nm-${t.taskName}-${i}`}
                      className="stage-tree__task"
                    >
                      <span className="stage-tree__task-name">
                        <span className="stage-tree__task-name-text">{t.taskName || '—'}</span>
                        {/* id del task (task_number de Zoho, el mismo de "Task #" en
                            Entries). Es largo → mono, atenuado y truncado, con tooltip. */}
                        {t.taskNumber ? (
                          <span className="stage-tree__task-id" title={`Task #${t.taskNumber}`}>
                            #{t.taskNumber}
                          </span>
                        ) : null}
                      </span>
                      {/* Horas CONSUMIDAS (Approved bill_to_client/sp_internal, mismo
                          criterio que Client Summary) + total logged como contexto cuando
                          difiere (así un task con horas rechazadas/overage no queda como
                          "0 h consumed" a secas). formatHours redondea. */}
                      {(() => {
                        const consumed = Number(t.consumedHours ?? 0)
                        const total = Number(t.hours ?? 0)
                        // Sin horas: '—' (no "0 h consumed"). Comparación sobre los valores
                        // MOSTRADOS (redondeados): sin "10 h consumed · 10 h logged"
                        // redundante por una diferencia sub-0.05; "logged" si difieren.
                        const consumedLabel = formatHours(consumed)
                        const totalLabel = formatHours(total)
                        return (
                          <span className="stage-tree__task-meta">
                            {total === 0 && consumed === 0
                              ? '—'
                              : `${consumedLabel} h consumed${consumedLabel !== totalLabel ? ` · ${totalLabel} h logged` : ''}`}
                          </span>
                        )
                      })()}
                    </li>
                  ))}
                </ul>
              ))}
          </li>
        )
      })}
      </ul>
    </>
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
  const [stageCount, setStageCount] = useState(null)
  const [stageCountError, setStageCountError] = useState(false)
  // Árbol stage → tasks (slice 12). Los tasks son a nivel proyecto (sin stageId en el
  // schema), así que hoy caen todos bajo "Sin stage"; ver open item. Los stages los
  // reusa el efecto de stageCount (no se re-piden); los tasks se cargan perezosamente
  // recién cuando se ve el slide (treeRequested).
  const [treeStages, setTreeStages] = useState([])
  const [treeTasks, setTreeTasks] = useState([])
  const [treeLoading, setTreeLoading] = useState(true)
  const [treeError, setTreeError] = useState(false)
  const [treeRequested, setTreeRequested] = useState(false)
  const [expandedStages, setExpandedStages] = useState(() => new Set())
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

  const taskTree = useMemo(
    () => buildProjectTaskTree(treeStages, treeTasks),
    [treeStages, treeTasks],
  )
  // Estado de la carga de stages para el slide del árbol (los stages los trae el
  // efecto de stageCount). Extraído para no repetir la regla en loading/error.
  const stagesPending = project.hasStages && stageCount === null && !stageCountError
  const stagesFailed = project.hasStages && stageCountError
  const toggleStage = (key) =>
    setExpandedStages((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

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
          budgetPending={loadingCrs}
          budgetError={crsLoadError}
        />
      ),
    },
    {
      key: 'stages-tasks',
      label: 'Stages & Tasks',
      content: (
        <StagesTasksSlide
          tree={taskTree}
          // stagesPending evita el parpadeo a "sin stages/tasks" si los tasks
          // resuelven antes que los stages.
          loading={treeLoading || stagesPending}
          // Error duro solo si fallan los TASKS (sin ellos no hay nada que mostrar).
          // Un fallo solo de stages no blanquea la sección: los tasks igual se
          // muestran (hoy son todos orphans) con un aviso — ver stagesError.
          error={treeError}
          stagesError={stagesFailed}
          expanded={expandedStages}
          onToggle={toggleStage}
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
  // Índice clampeado a [0, len-1], usado de forma consistente para el slide activo,
  // los vecinos y los extremos. goToSlide y el teclado ya clampan, pero derivarlo acá
  // también protege si en el futuro algún slide se vuelve condicional (el array cambia
  // de largo y slideIndex podría quedar fuera de rango).
  const safeIndex = Math.max(0, Math.min(slideIndex, slides.length - 1))
  const slide = slides[safeIndex]
  const prevSlide = slides[safeIndex - 1]
  const nextSlide = slides[safeIndex + 1]
  const atFirst = safeIndex === 0
  const atLast = safeIndex === slides.length - 1

  // Carga perezosa del árbol: marcamos treeRequested la primera vez que el usuario
  // ve el slide "Stages & Tasks" (no antes — el default es Overview).
  useEffect(() => {
    if (slide.key === 'stages-tasks') setTreeRequested(true)
  }, [slide.key])

  // Navegación no-cíclica (slice 13): clamp a [0, len-1] en vez de dar la vuelta.
  // Así el primer/último slide es un tope real y las flechas de los extremos se
  // deshabilitan, que es más intuitivo que el wrap-around.
  function goToSlide(i) {
    setSlideIndex(Math.max(0, Math.min(i, slides.length - 1)))
  }

  useScrollLock()

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
      .then((stages) => {
        if (cancelled) return
        setStageCount(stages.length)
        // Reusamos estos stages para el árbol (slide 12) en vez de re-pedirlos.
        setTreeStages(Array.isArray(stages) ? stages : [])
      })
      .catch((error) => {
        if (cancelled) return
        console.error('No se pudo cargar la cantidad de stages del proyecto:', error)
        setStageCountError(true)
      })
    return () => {
      cancelled = true
    }
  }, [project.id, project.hasStages])

  // Tasks del slide "Stages & Tasks". Carga perezosa (treeRequested). Une los tasks
  // REGISTRADOS del SOW (project_tasks, con su stage asignado) con los LOGUEADOS (los
  // distintos `task` de las horas de Zoho, con sus horas), matcheando por nombre — así el
  // árbol muestra cada task bajo su stage (o "No stage" si no tiene) con su consumido. Los
  // stages ya los trae el efecto de arriba.
  useEffect(() => {
    if (!treeRequested) return
    let cancelled = false
    setTreeLoading(true)
    setTreeError(false)
    // allSettled: si falla la lista de registrados (RLS, stub notImplemented del backend
    // http), los logueados igual se muestran — antes del merge sólo se pedían esos. Sólo
    // es error si fallan las DOS.
    Promise.allSettled([
      Promise.resolve().then(() => api.projectTasks.list(project.id)),
      Promise.resolve().then(() => api.projectTasks.logged(project.projectName)),
    ])
      .then(([registeredRes, loggedRes]) => {
        if (cancelled) return
        if (registeredRes.status === 'rejected' && loggedRes.status === 'rejected') {
          console.error('No se pudieron cargar los tasks del proyecto:', loggedRes.reason)
          setTreeError(true)
          return
        }
        const registered = registeredRes.status === 'fulfilled' ? registeredRes.value : []
        const logged = loggedRes.status === 'fulfilled' ? loggedRes.value : []
        setTreeTasks(mergeProjectTasks(registered ?? [], logged ?? []))
      })
      .finally(() => !cancelled && setTreeLoading(false))
    return () => {
      cancelled = true
    }
  }, [project.id, project.projectName, treeRequested])

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      // Las flechas navegan el carrusel, pero dentro de un input/select son
      // del usuario (mover el cursor, elegir opción) — si no, escribir en el
      // formulario de un slide lo desmonta y se pierde lo tipeado.
      const tag = event.target?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return
      if (event.key === 'ArrowLeft') goToSlide(slideIndexRef.current - 1)
      else if (event.key === 'ArrowRight') goToSlide(slideIndexRef.current + 1)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
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
              {/* "Proyecto · SOW-0000", como el mock: el número de SOW es la
                  forma en que se referencia el trabajo hacia afuera. */}
              {project.projectName}
              {project.sowNumber && (
                <span className="modal__title-sow"> · {project.sowNumber}</span>
              )}
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
              {safeIndex + 1} / {slides.length}
            </span>
          </div>
          <div className="carousel__body">{slide.content}</div>
          <div className="carousel__nav">
            {/* Flechas con el nombre del slide destino: se entiende hacia dónde
                navegan. En los extremos van deshabilitadas (nav no-cíclica). */}
            {/* aria-disabled (no el atributo `disabled`): en los extremos el botón se
                atenúa pero sigue enfocable — deshabilitar el que tiene foco lo tiraría
                al <body>. goToSlide clampa, así que el click en el extremo es no-op. */}
            <button
              type="button"
              className={`carousel__arrow${atFirst ? ' is-disabled' : ''}`}
              onClick={() => goToSlide(safeIndex - 1)}
              aria-disabled={atFirst}
              aria-label={
                prevSlide ? `Previous section: ${prevSlide.label}` : 'Previous section'
              }
            >
              <ChevronLeft size={16} aria-hidden="true" />
              <span className="carousel__arrow-label">{prevSlide ? prevSlide.label : ''}</span>
            </button>
            <div className="carousel__dots" role="tablist" aria-label="Project detail sections">
              {slides.map((s, i) => (
                <button
                  key={s.key}
                  type="button"
                  role="tab"
                  aria-selected={i === safeIndex}
                  aria-label={s.label}
                  className={`carousel__dot${i === safeIndex ? ' is-active' : ''}`}
                  onClick={() => goToSlide(i)}
                />
              ))}
            </div>
            <button
              type="button"
              className={`carousel__arrow${atLast ? ' is-disabled' : ''}`}
              onClick={() => goToSlide(safeIndex + 1)}
              aria-disabled={atLast}
              aria-label={nextSlide ? `Next section: ${nextSlide.label}` : 'Next section'}
            >
              <span className="carousel__arrow-label">{nextSlide ? nextSlide.label : ''}</span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
        </div>

      </motion.div>
    </motion.div>
  )
}
