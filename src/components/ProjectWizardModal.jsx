import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, ArrowLeft, FileUp, Loader2, Plus, Save, X } from 'lucide-react'
import { ClientPicker } from './ClientPicker'
import { parseSowDocument } from '../lib/sowParser'
import { isGenericFileType } from '../lib/projectsData'
import { fileNameFromPath } from '../lib/format'
import { api } from '../lib/api'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const STEPS = ['Identification', 'Scope', 'Maintenance', 'Tasks']

const SLA_PRESETS = {
  Standard: { transition: '60_days', hoursPool: '40', durationMonths: '6' },
  Premium: { transition: '30_days', hoursPool: '80', durationMonths: '12' },
}

const TRANSITION_LABEL = { '30_days': '30 days post-close', '60_days': '60 days post-close' }

function defaultSeverityTiers() {
  return [
    { severity: 'Critical', response: '< 4 business hours', scope: 'Production down, no workaround' },
    { severity: 'High', response: '< 1 business day', scope: 'Degraded, workaround exists' },
    { severity: 'Medium / Low', response: '< 3 business days', scope: 'Minor requests & tweaks' },
  ]
}

function newLocalId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function emptyStage() {
  return { localId: newLocalId('stage'), stageName: '', sowNumber: '', sowFile: null }
}

function emptyTask() {
  return { localId: newLocalId('task'), taskName: '', role: '', estimatedHours: '' }
}

function emptyForm() {
  return {
    clientId: null,
    clientName: '',
    projectName: '',
    sowNumber: '',
    sowFile: null,
    hasStages: false,
    stages: [],
    proposalNumber: '',
    budgetHours: '',
    periodStart: '',
    periodEnd: '',
    maintenanceEnabled: false,
    slaTemplate: 'Standard',
    maintenanceTransition: SLA_PRESETS.Standard.transition,
    maintenanceHoursPool: SLA_PRESETS.Standard.hoursPool,
    maintenanceDurationMonths: SLA_PRESETS.Standard.durationMonths,
    maintenanceSlaTiers: defaultSeverityTiers(),
    tasks: [],
  }
}

// Seed del form en edición: todo lo que ya vive como columna en `projects`
// (getProjects() ya lo trae). Stages/tasks existentes NO se precargan en
// `form` acá — viven en `existingStages`/`existingTasks` (fetched aparte,
// tienen su propio id real) para poder diferenciar "cambié esta" de "esta es
// nueva" al armar el payload de edición. `form.stages`/`form.tasks` en
// edición son solo las que se agregan en esta sesión (alta nueva sobre un
// proyecto existente), igual que en el alta.
function initialFormState(initial) {
  if (!initial) return emptyForm()
  return {
    clientId: initial.clientId,
    clientName: initial.client,
    projectName: initial.projectName ?? '',
    sowNumber: initial.sowNumber ?? '',
    sowFile: null,
    hasStages: initial.hasStages ?? false,
    stages: [],
    proposalNumber: initial.proposalNumber ?? '',
    budgetHours: initial.baseBudgetHours != null ? String(initial.baseBudgetHours) : '',
    periodStart: initial.periodStart ?? '',
    periodEnd: initial.periodEnd ?? '',
    maintenanceEnabled: initial.maintenanceEnabled ?? false,
    slaTemplate: initial.slaTemplate ?? 'Standard',
    maintenanceTransition: initial.maintenanceTransition ?? SLA_PRESETS.Standard.transition,
    maintenanceHoursPool:
      initial.maintenanceHoursPool != null ? String(initial.maintenanceHoursPool) : SLA_PRESETS.Standard.hoursPool,
    maintenanceDurationMonths:
      initial.maintenanceDurationMonths != null
        ? String(initial.maintenanceDurationMonths)
        : SLA_PRESETS.Standard.durationMonths,
    maintenanceSlaTiers: initial.maintenanceSlaTiers ?? defaultSeverityTiers(),
    tasks: [],
  }
}

/**
 * Wizard por pestañas de alta/edición de proyecto (Projects and SOW). En
 * edición ("Edit SOW & Scope" desde ProjectDetailCarousel, solo visible para
 * proyectos con clientId) cubre Identification/Scope/Maintenance — los
 * campos legacy (Contract Number, Customer Name, Approver, etc., sin
 * equivalente acá) siguen editándose con ProjectFormModal ("Edit", siempre
 * disponible, para cualquier proyecto). En edición, stages son editables
 * (nombre/número/reemplazo de SOW, sin delete — issue 03b) y se pueden
 * agregar nuevas; tasks siguen de solo lectura (su CRUD llega en issue 03c).
 *
 * @param {{
 *   initial?: object | null,   // proyecto a editar (null = alta)
 *   onClose: () => void,
 *   onSubmit: (
 *     payload: object,
 *     newSowFile?: File | null,
 *     // en edición: stages/tasks cambiadas o agregadas (issues 03b/03c),
 *     // undefined en alta
 *     childChanges?: {
 *       changedStages: Array, addedStages: Array, existingStagesCount: number,
 *       changedTasks: Array, addedTasks: Array,
 *     },
 *   ) => Promise<void>,
 * }} props
 */
export function ProjectWizardModal({ initial = null, onClose, onSubmit }) {
  const isEdit = Boolean(initial)
  const [step, setStep] = useState(0)
  const [form, setForm] = useState(() => initialFormState(initial))
  const [touchedSteps, setTouchedSteps] = useState([])
  const [parsing, setParsing] = useState(false)
  const [parseWarnings, setParseWarnings] = useState([])
  const [replacingSow, setReplacingSow] = useState(false)
  const [existingStages, setExistingStages] = useState([])
  const [existingTasks, setExistingTasks] = useState([])
  // Arranca en true en edición: existingTasks/existingStages están en su
  // default vacío hasta que el fetch resuelve — sin esto, "Loading…" y
  // "vacío de verdad" son indistinguibles el instante en que se abre el modal.
  const [loadingChildren, setLoadingChildren] = useState(isEdit)
  const [stagesLoadError, setStagesLoadError] = useState('')
  const [tasksLoadError, setTasksLoadError] = useState('')
  const [replacingStageIds, setReplacingStageIds] = useState(() => new Set())
  const [stageReplacementFiles, setStageReplacementFiles] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const dialogRef = useRef(null)
  const sowPickTokenRef = useRef(0)
  // Snapshot de como llegaron las stages/tasks del fetch — para el submit,
  // solo se manda update() de las que realmente cambiaron, no todas en cada
  // guardado.
  const originalStagesRef = useRef([])
  const originalTasksRef = useRef([])

  function setExistingStageField(id, key, value) {
    setExistingStages((prev) => prev.map((s) => (s.id === id ? { ...s, [key]: value } : s)))
  }

  function startReplacingStageSow(id) {
    setReplacingStageIds((prev) => new Set(prev).add(id))
  }

  function pickStageReplacementSow(id, file) {
    setStageReplacementFiles((prev) => ({ ...prev, [id]: file }))
  }

  function setExistingTaskField(id, key, value) {
    setExistingTasks((prev) => prev.map((t) => (t.id === id ? { ...t, [key]: value } : t)))
  }

  useEffect(() => {
    if (!isEdit) return
    let cancelled = false
    // allSettled, no all: un fallo en una de las dos no debe tirar la otra —
    // si no, "sin stages/tasks" (vacío real) queda indistinguible de "no se
    // pudo cargar" (fetch falló), y el usuario ve la lista vacía sin saber
    // cuál de las dos pasó. Stages solo se pide si el proyecto las tiene —
    // pedirlas siempre es una query de más para la mayoría de los proyectos
    // (sin stages), que ni se renderiza.
    Promise.allSettled([
      initial.hasStages ? api.projects.getStages(initial.id) : Promise.resolve([]),
      api.projectTasks.list(initial.id),
    ]).then(([stagesResult, tasksResult]) => {
      if (cancelled) return
      if (stagesResult.status === 'fulfilled') {
        setExistingStages(stagesResult.value)
        originalStagesRef.current = stagesResult.value
      } else {
        console.error('No se pudieron cargar los stages del proyecto:', stagesResult.reason)
        setStagesLoadError('Stages could not be loaded — try reopening this project.')
      }
      if (tasksResult.status === 'fulfilled') {
        setExistingTasks(tasksResult.value)
        originalTasksRef.current = tasksResult.value
      } else {
        console.error('No se pudieron cargar las tasks del proyecto:', tasksResult.reason)
        setTasksLoadError('Tasks could not be loaded — try reopening this project.')
      }
      setLoadingChildren(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKeyDown(e) {
      // Igual que el botón Cancel (disabled={submitting}): no se puede
      // cerrar el wizard mientras el alta está en vuelo — si no, el usuario
      // cree que canceló y el proyecto igual aparece segundos después.
      if (e.key === 'Escape' && !submitting) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose, submitting])

  function set(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function onPickSowFile(file) {
    setParseWarnings([])
    // Token de la selección actual: si el usuario cambia de archivo antes de
    // que este parse termine, el resultado viejo no debe pisar el form —
    // parseSowDocument no tiene forma de cancelarse a mitad de camino.
    const token = ++sowPickTokenRef.current
    // Cualquier selección nueva invalida un parse anterior en vuelo, así que
    // apaga su spinner ya mismo — su propio finally también chequea el
    // token, pero si esta selección no llega a setParsing(true) (los early
    // return de abajo) nadie más lo va a apagar.
    setParsing(false)
    if (!file) {
      set('sowFile', null)
      return
    }
    set('sowFile', file)
    // El navegador no siempre resuelve el MIME type de un .docx (falta la
    // asociación en el SO → llega '' o 'application/octet-stream'); en ese
    // caso confiamos en la extensión, igual que uploadSowFile en projectsData.js.
    const isDocx =
      file.type === DOCX_MIME || (isGenericFileType(file.type) && file.name.toLowerCase().endsWith('.docx'))
    if (!isDocx) return // PDF: sin auto-extract, se completa a mano

    setParsing(true)
    try {
      const parsed = await parseSowDocument(file)
      if (sowPickTokenRef.current !== token) return // el usuario ya eligió otro archivo
      const parsedBudgetHours = parsed.budgetHours != null ? String(parsed.budgetHours) : ''
      setForm((prev) =>
        isEdit
          // Reemplazo explícito en edición: el usuario acaba de elegir ESTE
          // documento a propósito — lo parseado gana sobre lo que ya estaba
          // precargado del proyecto (initialFormState), si no un replace
          // nunca actualizaría nada porque esos campos ya vienen no-vacíos.
          ? {
              ...prev,
              sowNumber: parsed.sowNumber || prev.sowNumber || '',
              budgetHours: parsedBudgetHours || prev.budgetHours || '',
              periodStart: parsed.periodStart || prev.periodStart || '',
              periodEnd: parsed.periodEnd || prev.periodEnd || '',
            }
          : {
              ...prev,
              sowNumber: prev.sowNumber || parsed.sowNumber || '',
              budgetHours: prev.budgetHours || parsedBudgetHours,
              periodStart: prev.periodStart || parsed.periodStart || '',
              periodEnd: prev.periodEnd || parsed.periodEnd || '',
            },
      )
      setParseWarnings(parsed.warnings)
    } finally {
      if (sowPickTokenRef.current === token) setParsing(false)
    }
  }

  function toggleHasStages(checked) {
    setForm((prev) => ({
      ...prev,
      hasStages: checked,
      stages: checked && prev.stages.length === 0 ? [emptyStage()] : prev.stages,
    }))
  }

  function addStage() {
    setForm((prev) => ({ ...prev, stages: [...prev.stages, emptyStage()] }))
  }

  function removeStage(localId) {
    setForm((prev) => ({ ...prev, stages: prev.stages.filter((s) => s.localId !== localId) }))
  }

  function setStageField(localId, key, value) {
    setForm((prev) => ({
      ...prev,
      stages: prev.stages.map((s) => (s.localId === localId ? { ...s, [key]: value } : s)),
    }))
  }

  function onSlaTemplateChange(template) {
    setForm((prev) => {
      const preset = SLA_PRESETS[template]
      return {
        ...prev,
        slaTemplate: template,
        maintenanceTransition: preset ? preset.transition : prev.maintenanceTransition,
        maintenanceHoursPool: preset ? preset.hoursPool : prev.maintenanceHoursPool,
        maintenanceDurationMonths: preset ? preset.durationMonths : prev.maintenanceDurationMonths,
        // Standard/Premium muestran texto fijo de severidad — si el usuario
        // veía ediciones de un paso previo por Custom, tienen que volver a
        // los valores canónicos de la plantilla, no quedarse pegadas.
        maintenanceSlaTiers: preset ? defaultSeverityTiers() : prev.maintenanceSlaTiers,
      }
    })
  }

  function setSeverityField(index, key, value) {
    setForm((prev) => ({
      ...prev,
      maintenanceSlaTiers: prev.maintenanceSlaTiers.map((t, i) => (i === index ? { ...t, [key]: value } : t)),
    }))
  }

  function addSeverityTier() {
    setForm((prev) => ({
      ...prev,
      maintenanceSlaTiers: [...prev.maintenanceSlaTiers, { severity: '', response: '', scope: '' }],
    }))
  }

  function removeSeverityTier(index) {
    setForm((prev) => ({
      ...prev,
      maintenanceSlaTiers: prev.maintenanceSlaTiers.filter((_, i) => i !== index),
    }))
  }

  function addTask() {
    setForm((prev) => ({ ...prev, tasks: [...prev.tasks, emptyTask()] }))
  }

  function removeTask(localId) {
    setForm((prev) => ({ ...prev, tasks: prev.tasks.filter((t) => t.localId !== localId) }))
  }

  function setTaskField(localId, key, value) {
    setForm((prev) => ({
      ...prev,
      tasks: prev.tasks.map((t) => (t.localId === localId ? { ...t, [key]: value } : t)),
    }))
  }

  const tasksTotalHours =
    form.tasks.reduce((sum, t) => sum + (Number(t.estimatedHours) || 0), 0) +
    (isEdit ? existingTasks.reduce((sum, t) => sum + (Number(t.estimatedHours) || 0), 0) : 0)

  // Una stage recién agregada en esta sesión (form.stages) necesita sus 3
  // campos; una ya persistida (existingStages, issue 03b) no puede perder
  // nombre/número (sigue siendo `text not null`), pero su SOW File es
  // opcional de reemplazar — el que ya tiene sigue siendo válido.
  const stageMissing = (s) => !s.stageName.trim() || !s.sowNumber.trim() || !s.sowFile
  const existingStageMissing = (s) => !s.stageName.trim() || !s.sowNumber.trim()
  // En edición ya hay un SOW subido (initial.sowUrl) — no reemplazarlo no es
  // un error, solo "no hay archivo nuevo".
  const hasSowFileNow = isEdit ? Boolean(initial.sowUrl) || Boolean(form.sowFile) : Boolean(form.sowFile)
  const step1Missing = {
    clientId: !isEdit && !form.clientId,
    projectName: !form.projectName.trim(),
    sowNumber: !form.hasStages && !form.sowNumber.trim(),
    sowFile: !form.hasStages && !hasSowFileNow,
    stages:
      form.hasStages &&
      // Si el fetch de stages falló, existingStagesCount (existingStages.length)
      // quedaría en 0 aunque el proyecto ya tenga stages reales — guardar en
      // ese estado haría que las agregadas nuevas choquen de posición con
      // las que ya existen y no se llegaron a traer. Bloquea el guardado
      // hasta reabrir el modal (el error ya se muestra en la sección).
      ((isEdit && (Boolean(stagesLoadError) || existingStages.some(existingStageMissing))) ||
        form.stages.some(stageMissing) ||
        (!isEdit && form.stages.length === 0)),
  }
  // !(n > 0) en vez de n <= 0: Number(x) <= 0 es false para NaN (un valor no
  // numérico colaría como "válido"), !(NaN > 0) es true — rechaza tanto NaN
  // como vacío/cero/negativo en una sola condición.
  const step2Missing = {
    budgetHours: !(Number(form.budgetHours) > 0),
    periodStart: !form.periodStart,
    periodEnd: !form.periodEnd,
  }
  const step3Missing = {
    hoursPool: form.maintenanceEnabled && !(Number(form.maintenanceHoursPool) > 0),
    durationMonths: form.maintenanceEnabled && !(Number(form.maintenanceDurationMonths) > 0),
  }
  // Igual que las stages: una task existente (issue 03c) no puede perder su
  // nombre (`text not null`) ni quedar con horas inválidas (`check >= 0`,
  // el input numérico con min="0" no impide tipear un signo "-"). Una task
  // nueva (form.tasks, alta o agregada en edición) con nombre pero horas
  // inválidas tiene el mismo problema — si no, llega a Supabase y el check
  // constraint la rechaza con un error crudo en vez de bloquear acá.
  const hoursInvalid = (hours) => !(Number(hours) >= 0)
  const existingTaskMissing = (t) => !t.taskName.trim() || hoursInvalid(t.estimatedHours)
  const newTaskInvalid = (t) => t.taskName.trim() && hoursInvalid(t.estimatedHours)
  const step4Missing = {
    tasks:
      (isEdit && (Boolean(tasksLoadError) || existingTasks.some(existingTaskMissing))) ||
      form.tasks.some(newTaskInvalid),
  }
  const step1Valid = !Object.values(step1Missing).some(Boolean)
  const step2Valid = !Object.values(step2Missing).some(Boolean)
  const step3Valid = !Object.values(step3Missing).some(Boolean)
  const step4Valid = !Object.values(step4Missing).some(Boolean)
  const touched = (s) => touchedSteps.includes(s)

  function goNext() {
    setTouchedSteps((prev) => [...new Set([...prev, step])])
    if (step === 0 && !step1Valid) return
    if (step === 1 && !step2Valid) return
    if (step === 2 && !step3Valid) return
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  function maintenanceFields() {
    return {
      maintenanceEnabled: form.maintenanceEnabled,
      slaTemplate: form.maintenanceEnabled ? form.slaTemplate : null,
      maintenanceTransition: form.maintenanceEnabled ? form.maintenanceTransition : null,
      maintenanceHoursPool: form.maintenanceEnabled ? Number(form.maintenanceHoursPool) : null,
      maintenanceDurationMonths: form.maintenanceEnabled ? Number(form.maintenanceDurationMonths) : null,
      maintenanceSlaTiers: form.maintenanceEnabled && form.slaTemplate === 'Custom' ? form.maintenanceSlaTiers : null,
    }
  }

  async function handleFinish() {
    setTouchedSteps([0, 1, 2, 3])
    // loadingChildren: si el fetch de stages/tasks todavía no resolvió,
    // existingStages/existingTasks están en su default vacío — guardar en
    // ese estado mandaría existingStagesCount=0 (colisión de posición con
    // las stages reales todavía no traídas) y pisaría ediciones concurrentes
    // a tasks existentes sin que este submit las viera.
    if (!step1Valid || !step2Valid || !step3Valid || !step4Valid || loadingChildren || submitting) return
    setSubmitError('')
    setSubmitting(true)
    try {
      if (isEdit) {
        // Solo se manda sowNumber/sowFile si el proyecto no tiene stages (con
        // stages, el SOW vive por-stage, sin equivalente a nivel proyecto).
        const updates = {
          projectName: form.projectName.trim(),
          proposalNumber: form.proposalNumber.trim() || null,
          baseBudgetHours: Number(form.budgetHours),
          periodStart: form.periodStart,
          periodEnd: form.periodEnd,
          ...maintenanceFields(),
        }
        if (!form.hasStages) updates.sowNumber = form.sowNumber.trim()

        // Stages (issue 03b): solo se manda update de las que realmente
        // cambiaron (nombre/número/archivo) contra el snapshot del fetch —
        // no tiene sentido re-escribir las que el usuario no tocó. Las
        // agregadas en esta sesión (form.stages) van aparte, como alta.
        const changedStages = form.hasStages
          ? existingStages
              .filter((s) => {
                const original = originalStagesRef.current.find((o) => o.id === s.id)
                return (
                  !original ||
                  s.stageName !== original.stageName ||
                  s.sowNumber !== original.sowNumber ||
                  stageReplacementFiles[s.id]
                )
              })
              .map((s) => ({
                // El resto de los campos del stage original (position,
                // sowUrl, createdAt, createdBy) viaja completo — updateStage
                // en modo demo hace `{...current, ...updates}`, y si acá
                // solo mandáramos {id, stageName, sowNumber} el resto se
                // perdería del registro guardado (el path real de Supabase
                // solo usa current.id, así que no cambia nada ahí).
                ...s,
                stageName: s.stageName.trim(),
                sowNumber: s.sowNumber.trim(),
                sowFile: stageReplacementFiles[s.id] ?? null,
              }))
          : []
        const addedStages = form.hasStages
          ? form.stages.map((s) => ({ stageName: s.stageName.trim(), sowNumber: s.sowNumber.trim(), sowFile: s.sowFile }))
          : []

        // Tasks (issue 03c): mismo criterio que stages — solo las que
        // cambiaron contra el snapshot del fetch, más las agregadas en esta
        // sesión (sin archivo, a diferencia de las stages).
        const changedTasks = existingTasks
          .filter((t) => {
            const original = originalTasksRef.current.find((o) => o.id === t.id)
            return (
              !original ||
              t.taskName !== original.taskName ||
              (t.role || null) !== (original.role || null) ||
              Number(t.estimatedHours) !== Number(original.estimatedHours)
            )
          })
          .map((t) => ({
            // Igual que con las stages: el resto de los campos originales
            // (projectId, createdAt, createdBy) viaja completo — el merge en
            // modo demo de updateProjectTask los necesita, el path real de
            // Supabase solo usa t.id.
            ...t,
            taskName: t.taskName.trim(),
            // t.role puede venir null de la DB (rowToTask) — a diferencia de
            // form.tasks, donde siempre arranca en '' (ver emptyTask()).
            role: (t.role ?? '').trim() || null,
            estimatedHours: Number(t.estimatedHours),
          }))
        const addedTasks = form.tasks
          .filter((t) => t.taskName.trim())
          .map((t) => ({
            taskName: t.taskName.trim(),
            role: t.role.trim() || null,
            estimatedHours: Number(t.estimatedHours) || 0,
          }))

        await onSubmit(updates, form.hasStages ? null : form.sowFile, {
          changedStages,
          addedStages,
          existingStagesCount: existingStages.length,
          changedTasks,
          addedTasks,
        })
      } else {
        await onSubmit({
          clientId: form.clientId,
          client: form.clientName,
          projectName: form.projectName.trim(),
          // No reusar el SOW number como project_number: el SOW number es por
          // cliente, project_number es único global (0004_projects.sql) — dos
          // clientes con el mismo número de SOW chocarían. project_number
          // queda sin poblar (ya es nullable desde 0022); el SOW number real
          // vive en sowNumber/sow_number.
          projectNumber: null,
          sowNumber: form.hasStages ? null : form.sowNumber.trim(),
          sowFile: form.hasStages ? null : form.sowFile,
          hasStages: form.hasStages,
          stageName: null, // reemplazado por project_stages cuando hasStages
          stages: form.hasStages
            ? form.stages.map((s) => ({ stageName: s.stageName.trim(), sowNumber: s.sowNumber.trim(), sowFile: s.sowFile }))
            : [],
          proposalNumber: form.proposalNumber.trim() || null,
          baseBudgetHours: Number(form.budgetHours),
          model: 'Time & Materials',
          periodStart: form.periodStart,
          periodEnd: form.periodEnd,
          ...maintenanceFields(),
          tasks: form.tasks
            .filter((t) => t.taskName.trim())
            .map((t) => ({
              taskName: t.taskName.trim(),
              role: t.role.trim() || null,
              estimatedHours: Number(t.estimatedHours) || 0,
            })),
        })
      }
    } catch (error) {
      setSubmitting(false)
      setSubmitError(error?.message ?? 'Could not save.')
    }
  }

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
        className="modal modal--form modal--wizard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-wizard-title"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="modal__head">
          <div>
            <span className="modal__kicker">Projects and SOW</span>
            <h2 className="modal__title" id="project-wizard-title">
              {isEdit ? `Edit project · ${initial.projectName}` : 'New project'}
            </h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="wizard-steps" role="tablist" aria-label="Wizard steps">
          {STEPS.map((label, i) => (
            <span
              key={label}
              className={`wizard-steps__item${i === step ? ' is-active' : ''}${i < step ? ' is-done' : ''}`}
              role="tab"
              aria-selected={i === step}
            >
              {i + 1}. {label}
            </span>
          ))}
        </div>

        <div className="modal__form project-form">
          {step === 0 && (
            <div className="project-form__grid">
              {isEdit ? (
                <div className="field">
                  <label className="field__label">Client</label>
                  <div className="field__input" style={{ color: 'var(--text-soft)' }}>
                    {form.clientName}
                  </div>
                </div>
              ) : (
                <ClientPicker
                  value={form.clientId}
                  onChange={(id, client) => {
                    set('clientId', id)
                    set('clientName', client?.clientName ?? '')
                  }}
                  error={touched(0) && step1Missing.clientId ? 'Pick a client to continue.' : ''}
                />
              )}

              <div className="field">
                <label className="field__label" htmlFor="wz-project-name">
                  Project Name
                  <span className="field__req">required</span>
                </label>
                <input
                  id="wz-project-name"
                  className={`field__input${touched(0) && step1Missing.projectName ? ' field__input--error' : ''}`}
                  value={form.projectName}
                  disabled={!form.clientId}
                  onChange={(e) => set('projectName', e.target.value)}
                  autoComplete="off"
                />
              </div>

              {!form.hasStages && (
                <>
                  <div className="field">
                    <label className="field__label" htmlFor="wz-sow-number">
                      SOW Number
                      <span className="field__req">required</span>
                    </label>
                    <input
                      id="wz-sow-number"
                      className={`field__input${touched(0) && step1Missing.sowNumber ? ' field__input--error' : ''}`}
                      value={form.sowNumber}
                      disabled={!form.clientId}
                      onChange={(e) => set('sowNumber', e.target.value)}
                      autoComplete="off"
                    />
                  </div>

                  <div className="field">
                    <label className="field__label" htmlFor="wz-sow-file">
                      SOW File
                      {!isEdit && <span className="field__req">required</span>}
                      <span className="field__hint">.docx (auto-fills Scope) or PDF</span>
                    </label>
                    {isEdit && !replacingSow ? (
                      <div className="field__input" style={{ justifyContent: 'space-between' }}>
                        <span className="field__filename">{fileNameFromPath(initial.sowUrl)}</span>
                        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setReplacingSow(true)}>
                          Replace
                        </button>
                      </div>
                    ) : (
                      <input
                        id="wz-sow-file"
                        type="file"
                        accept=".docx,application/pdf,.pdf"
                        className="field__input field__input--file"
                        disabled={!form.clientId}
                        onChange={(e) => onPickSowFile(e.target.files?.[0] ?? null)}
                      />
                    )}
                    {parsing && (
                      <span className="field__hint">
                        <Loader2 size={13} className="icon-spin" aria-hidden="true" /> Reading SOW…
                      </span>
                    )}
                    {form.sowFile && !parsing && (
                      <span className="field__filename">
                        <FileUp size={13} aria-hidden="true" /> {form.sowFile.name}
                      </span>
                    )}
                    {touched(0) && step1Missing.sowFile && (
                      <span className="field__error">The SOW file is required.</span>
                    )}
                    {parseWarnings.map((w, i) => (
                      <span className="field__error" key={i}>
                        {w}
                      </span>
                    ))}
                    {isEdit && replacingSow && (
                      <span className="field__hint">
                        Replacing uploads a new version — the previous one stays in history, never deleted.
                      </span>
                    )}
                  </div>
                </>
              )}

              {isEdit ? (
                <div className="field">
                  <label className="field__label">Has stages?</label>
                  <div className="field__input" style={{ color: 'var(--text-soft)' }}>
                    {form.hasStages ? 'Yes' : 'No'}
                  </div>
                </div>
              ) : (
                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={form.hasStages}
                    disabled={!form.clientId}
                    onChange={(e) => toggleHasStages(e.target.checked)}
                  />
                  Has stages?
                </label>
              )}

              {form.hasStages && (
                <div className="stage-list">
                  {isEdit && loadingChildren && <p className="field__hint">Loading…</p>}
                  {isEdit &&
                    !loadingChildren &&
                    existingStages.map((s) => {
                      const missing = touched(0) && existingStageMissing(s)
                      const isReplacing = replacingStageIds.has(s.id)
                      return (
                        <div className="stage-row" key={s.id}>
                          <div className="field">
                            <label className="field__label" htmlFor={`wz-existing-stage-name-${s.id}`}>
                              Stage Name
                              <span className="field__req">required</span>
                            </label>
                            <input
                              id={`wz-existing-stage-name-${s.id}`}
                              className={`field__input${missing && !s.stageName.trim() ? ' field__input--error' : ''}`}
                              value={s.stageName}
                              onChange={(e) => setExistingStageField(s.id, 'stageName', e.target.value)}
                              autoComplete="off"
                            />
                          </div>
                          <div className="field">
                            <label className="field__label" htmlFor={`wz-existing-stage-sow-number-${s.id}`}>
                              SOW Number
                              <span className="field__req">required</span>
                            </label>
                            <input
                              id={`wz-existing-stage-sow-number-${s.id}`}
                              className={`field__input cell-mono${missing && !s.sowNumber.trim() ? ' field__input--error' : ''}`}
                              value={s.sowNumber}
                              onChange={(e) => setExistingStageField(s.id, 'sowNumber', e.target.value)}
                              autoComplete="off"
                            />
                          </div>
                          <div className="field">
                            <label className="field__label">SOW File</label>
                            {isReplacing ? (
                              <input
                                type="file"
                                accept=".docx,application/pdf,.pdf"
                                className="field__input field__input--file"
                                onChange={(e) => pickStageReplacementSow(s.id, e.target.files?.[0] ?? null)}
                              />
                            ) : (
                              <div className="field__input" style={{ justifyContent: 'space-between' }}>
                                <span className="field__filename">{fileNameFromPath(s.sowUrl)}</span>
                                <button
                                  type="button"
                                  className="btn btn--ghost btn--sm"
                                  onClick={() => startReplacingStageSow(s.id)}
                                >
                                  Replace
                                </button>
                              </div>
                            )}
                            {stageReplacementFiles[s.id] && (
                              <span className="field__filename">
                                <FileUp size={13} aria-hidden="true" /> {stageReplacementFiles[s.id].name}
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  {isEdit && stagesLoadError && <p className="field__error">{stagesLoadError}</p>}
                  {form.stages.map((s, i) => (
                    <div className="stage-row" key={s.localId}>
                      <div className="field">
                        <label className="field__label" htmlFor={`wz-stage-name-${s.localId}`}>
                          Stage {i + 1} Name
                          <span className="field__req">required</span>
                        </label>
                        <input
                          id={`wz-stage-name-${s.localId}`}
                          className={`field__input${touched(0) && step1Missing.stages && !s.stageName.trim() ? ' field__input--error' : ''}`}
                          value={s.stageName}
                          onChange={(e) => setStageField(s.localId, 'stageName', e.target.value)}
                          autoComplete="off"
                        />
                      </div>
                      <div className="field">
                        <label className="field__label" htmlFor={`wz-stage-sow-number-${s.localId}`}>
                          SOW Number
                          <span className="field__req">required</span>
                        </label>
                        <input
                          id={`wz-stage-sow-number-${s.localId}`}
                          className={`field__input${touched(0) && step1Missing.stages && !s.sowNumber.trim() ? ' field__input--error' : ''}`}
                          value={s.sowNumber}
                          onChange={(e) => setStageField(s.localId, 'sowNumber', e.target.value)}
                          autoComplete="off"
                        />
                      </div>
                      <div className="field">
                        <label className="field__label" htmlFor={`wz-stage-sow-file-${s.localId}`}>
                          SOW File
                          <span className="field__req">required</span>
                        </label>
                        <input
                          id={`wz-stage-sow-file-${s.localId}`}
                          type="file"
                          accept=".docx,application/pdf,.pdf"
                          className={`field__input field__input--file${touched(0) && step1Missing.stages && !s.sowFile ? ' field__input--error' : ''}`}
                          onChange={(e) => setStageField(s.localId, 'sowFile', e.target.files?.[0] ?? null)}
                        />
                        {s.sowFile && (
                          <span className="field__filename">
                            <FileUp size={13} aria-hidden="true" /> {s.sowFile.name}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="icon-btn stage-row__remove"
                        onClick={() => removeStage(s.localId)}
                        aria-label={`Remove stage ${i + 1}`}
                        disabled={!isEdit && form.stages.length === 1}
                        title={
                          !isEdit && form.stages.length === 1 ? 'A project with stages needs at least one' : 'Remove stage'
                        }
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                  <button type="button" className="btn btn--ghost btn--sm link-add" onClick={addStage}>
                    <Plus size={14} aria-hidden="true" /> Add stage
                  </button>
                  <p className="field__hint">
                    Budget hours and period (next tab) stay project-level even with several stages.
                  </p>
                </div>
              )}

              <div className="field">
                <label className="field__label" htmlFor="wz-proposal-number">
                  Proposal Number
                  <span className="field__hint">optional</span>
                </label>
                <input
                  id="wz-proposal-number"
                  className="field__input"
                  value={form.proposalNumber}
                  disabled={!form.clientId}
                  onChange={(e) => set('proposalNumber', e.target.value)}
                  autoComplete="off"
                />
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="project-form__grid">
              <div className="field">
                <label className="field__label" htmlFor="wz-budget-hours">
                  Budget Hours
                  <span className="field__req">required</span>
                </label>
                <input
                  id="wz-budget-hours"
                  type="number"
                  min="0"
                  step="0.5"
                  className={`field__input${touched(1) && step2Missing.budgetHours ? ' field__input--error' : ''}`}
                  value={form.budgetHours}
                  onChange={(e) => set('budgetHours', e.target.value)}
                />
              </div>

              <div className="field">
                <label className="field__label">Model</label>
                <div className="field__input" style={{ color: 'var(--text-soft)' }}>
                  Time &amp; Materials
                </div>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="wz-period-start">
                  Start Date
                  <span className="field__req">required</span>
                </label>
                <input
                  id="wz-period-start"
                  type="date"
                  className={`field__input${touched(1) && step2Missing.periodStart ? ' field__input--error' : ''}`}
                  value={form.periodStart}
                  onChange={(e) => set('periodStart', e.target.value)}
                />
              </div>

              <div className="field">
                <label className="field__label" htmlFor="wz-period-end">
                  End Date
                  <span className="field__req">required</span>
                </label>
                <input
                  id="wz-period-end"
                  type="date"
                  className={`field__input${touched(1) && step2Missing.periodEnd ? ' field__input--error' : ''}`}
                  value={form.periodEnd}
                  onChange={(e) => set('periodEnd', e.target.value)}
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="project-form__grid project-form__grid--single">
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={form.maintenanceEnabled}
                  onChange={(e) => set('maintenanceEnabled', e.target.checked)}
                />
                Enable maintenance for this SOW
              </label>

              {form.maintenanceEnabled && (
                <>
                  <div className="project-form__grid">
                    <div className="field">
                      <label className="field__label" htmlFor="wz-sla-template">SLA Template</label>
                      <select
                        id="wz-sla-template"
                        className="field__input"
                        value={form.slaTemplate}
                        onChange={(e) => onSlaTemplateChange(e.target.value)}
                      >
                        <option value="Standard">Standard · 60d / 40h / 6m</option>
                        <option value="Premium">Premium · 30d / 80h / 12m</option>
                        <option value="Custom">Custom</option>
                      </select>
                    </div>
                    <div className="field">
                      <label className="field__label">Transition to Maintenance</label>
                      <div className="field__input" style={{ color: 'var(--text-soft)' }}>
                        {TRANSITION_LABEL[form.maintenanceTransition] ?? form.maintenanceTransition}
                      </div>
                    </div>
                    <div className="field">
                      <label className="field__label" htmlFor="wz-hours-pool">
                        Hours Pool
                        <span className="field__req">required</span>
                      </label>
                      <input
                        id="wz-hours-pool"
                        type="number"
                        min="0"
                        step="1"
                        className={`field__input${touched(2) && step3Missing.hoursPool ? ' field__input--error' : ''}`}
                        value={form.maintenanceHoursPool}
                        disabled={form.slaTemplate !== 'Custom'}
                        onChange={(e) => set('maintenanceHoursPool', e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label className="field__label" htmlFor="wz-duration-months">
                        Duration (months)
                        <span className="field__req">required</span>
                      </label>
                      <input
                        id="wz-duration-months"
                        type="number"
                        min="0"
                        step="1"
                        className={`field__input${touched(2) && step3Missing.durationMonths ? ' field__input--error' : ''}`}
                        value={form.maintenanceDurationMonths}
                        disabled={form.slaTemplate !== 'Custom'}
                        onChange={(e) => set('maintenanceDurationMonths', e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="table-wrap">
                    <table className="table table--form">
                      <thead>
                        <tr>
                          <th scope="col">Severity</th>
                          <th scope="col">Response</th>
                          <th scope="col">Scope</th>
                          {form.slaTemplate === 'Custom' && <th scope="col" aria-label="Remove" />}
                        </tr>
                      </thead>
                      <tbody>
                        {form.maintenanceSlaTiers.map((tier, i) => (
                          <tr key={i}>
                            <td>
                              {form.slaTemplate === 'Custom' ? (
                                <input
                                  className="field__input"
                                  value={tier.severity}
                                  onChange={(e) => setSeverityField(i, 'severity', e.target.value)}
                                />
                              ) : (
                                tier.severity
                              )}
                            </td>
                            <td>
                              {form.slaTemplate === 'Custom' ? (
                                <input
                                  className="field__input"
                                  value={tier.response}
                                  onChange={(e) => setSeverityField(i, 'response', e.target.value)}
                                />
                              ) : (
                                tier.response
                              )}
                            </td>
                            <td>
                              {form.slaTemplate === 'Custom' ? (
                                <input
                                  className="field__input"
                                  value={tier.scope}
                                  onChange={(e) => setSeverityField(i, 'scope', e.target.value)}
                                />
                              ) : (
                                tier.scope
                              )}
                            </td>
                            {form.slaTemplate === 'Custom' && (
                              <td>
                                <button
                                  type="button"
                                  className="icon-btn"
                                  onClick={() => removeSeverityTier(i)}
                                  aria-label={`Remove severity row ${i + 1}`}
                                >
                                  <X size={14} />
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {form.slaTemplate === 'Custom' && (
                    <button type="button" className="btn btn--ghost btn--sm link-add" onClick={addSeverityTier}>
                      <Plus size={14} aria-hidden="true" /> Add severity
                    </button>
                  )}
                  <p className="field__hint">
                    Fields and severity rows are only editable when the template is Custom.
                  </p>
                </>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="project-form__grid project-form__grid--single">
              <p className="field__hint">
                {isEdit
                  ? 'Estimated hours per task. Actual hours and deviation are calculated later against Entries.'
                  : 'Optional — estimated hours per task. Actual hours and deviation are calculated later against Entries.'}
              </p>
              {isEdit && loadingChildren && <p className="field__hint">Loading…</p>}
              {isEdit && tasksLoadError && <p className="field__error">{tasksLoadError}</p>}
              {isEdit &&
                !loadingChildren &&
                existingTasks.length === 0 &&
                form.tasks.length === 0 &&
                !tasksLoadError && <p className="field__hint">No tasks recorded.</p>}
              {(existingTasks.length > 0 || form.tasks.length > 0) && (
                <div className="table-wrap">
                  <table className="table table--form">
                    <thead>
                      <tr>
                        <th scope="col">Task Name</th>
                        <th scope="col">Role</th>
                        <th scope="col" className="col-num">Est. Hours</th>
                        <th scope="col" aria-label="Remove" />
                      </tr>
                    </thead>
                    <tbody>
                      {isEdit &&
                        existingTasks.map((t) => {
                          const missing = touched(3) && existingTaskMissing(t)
                          return (
                            <tr key={t.id}>
                              <td>
                                <input
                                  className={`field__input${missing && !t.taskName.trim() ? ' field__input--error' : ''}`}
                                  value={t.taskName}
                                  onChange={(e) => setExistingTaskField(t.id, 'taskName', e.target.value)}
                                  autoComplete="off"
                                />
                              </td>
                              <td>
                                <input
                                  className="field__input"
                                  value={t.role ?? ''}
                                  onChange={(e) => setExistingTaskField(t.id, 'role', e.target.value)}
                                  autoComplete="off"
                                />
                              </td>
                              <td>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.5"
                                  className={`field__input${missing && hoursInvalid(t.estimatedHours) ? ' field__input--error' : ''}`}
                                  value={t.estimatedHours}
                                  onChange={(e) => setExistingTaskField(t.id, 'estimatedHours', e.target.value)}
                                />
                              </td>
                              <td />
                            </tr>
                          )
                        })}
                      {form.tasks.map((t) => (
                        <tr key={t.localId}>
                          <td>
                            <input
                              className="field__input"
                              value={t.taskName}
                              onChange={(e) => setTaskField(t.localId, 'taskName', e.target.value)}
                              autoComplete="off"
                            />
                          </td>
                          <td>
                            <input
                              className="field__input"
                              value={t.role}
                              onChange={(e) => setTaskField(t.localId, 'role', e.target.value)}
                              autoComplete="off"
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              step="0.5"
                              className={`field__input${touched(3) && newTaskInvalid(t) ? ' field__input--error' : ''}`}
                              value={t.estimatedHours}
                              onChange={(e) => setTaskField(t.localId, 'estimatedHours', e.target.value)}
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              className="icon-btn"
                              onClick={() => removeTask(t.localId)}
                              aria-label={`Remove task ${t.taskName || ''}`}
                            >
                              <X size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={2}>Total</td>
                        <td className="col-num">{tasksTotalHours}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
              <button type="button" className="btn btn--ghost btn--sm link-add" onClick={addTask}>
                <Plus size={14} aria-hidden="true" /> Add task
              </button>
            </div>
          )}

          {submitError && (
            <p className="modal__submit-error" role="alert">{submitError}</p>
          )}

          <div className="modal__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            {step > 0 && (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setStep((s) => Math.max(s - 1, 0))}
                disabled={submitting}
              >
                <ArrowLeft size={16} aria-hidden="true" /> Back
              </button>
            )}
            {step < STEPS.length - 1 ? (
              <button type="button" className="btn btn--pay" onClick={goNext}>
                Next <ArrowRight size={16} aria-hidden="true" />
              </button>
            ) : (
              <motion.button
                type="button"
                className="btn btn--pay"
                onClick={handleFinish}
                disabled={submitting || loadingChildren}
                whileTap={!submitting && !loadingChildren ? { scale: 0.97 } : undefined}
              >
                {submitting ? (
                  <span className="spinner" aria-hidden="true" />
                ) : isEdit ? (
                  <Save size={16} aria-hidden="true" />
                ) : null}
                {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Finish'}
              </motion.button>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
