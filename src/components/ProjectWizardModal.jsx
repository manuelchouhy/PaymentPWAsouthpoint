import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, ArrowLeft, FileUp, Loader2, Plus, X } from 'lucide-react'
import { ClientPicker } from './ClientPicker'
import { parseSowDocument } from '../lib/sowParser'

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

/**
 * Wizard por pestañas de alta de proyecto (Projects and SOW). Solo alta —
 * editar un proyecto existente sigue usando ProjectFormModal para los campos
 * legacy; el detalle/edición del SOW, stages, mantenimiento y tasks queda
 * para el carrusel de detalle (fuera de este slice).
 *
 * @param {{ onClose: () => void, onSubmit: (payload: object) => Promise<void> }} props
 */
export function ProjectWizardModal({ onClose, onSubmit }) {
  const [step, setStep] = useState(0)
  const [form, setForm] = useState(emptyForm)
  const [touchedSteps, setTouchedSteps] = useState([])
  const [parsing, setParsing] = useState(false)
  const [parseWarnings, setParseWarnings] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const dialogRef = useRef(null)

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

  function set(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function onPickSowFile(file) {
    setParseWarnings([])
    if (!file) {
      set('sowFile', null)
      return
    }
    set('sowFile', file)
    if (file.type !== DOCX_MIME) return // PDF: sin auto-extract, se completa a mano

    setParsing(true)
    try {
      const parsed = await parseSowDocument(file)
      setForm((prev) => ({
        ...prev,
        sowNumber: prev.sowNumber || parsed.sowNumber || '',
        budgetHours: prev.budgetHours || (parsed.budgetHours != null ? String(parsed.budgetHours) : ''),
        periodStart: prev.periodStart || parsed.periodStart || '',
        periodEnd: prev.periodEnd || parsed.periodEnd || '',
      }))
      setParseWarnings(parsed.warnings)
    } finally {
      setParsing(false)
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

  const tasksTotalHours = form.tasks.reduce((sum, t) => sum + (Number(t.estimatedHours) || 0), 0)

  const stageMissing = (s) => !s.stageName.trim() || !s.sowNumber.trim() || !s.sowFile
  const step1Missing = {
    clientId: !form.clientId,
    projectName: !form.projectName.trim(),
    sowNumber: !form.hasStages && !form.sowNumber.trim(),
    sowFile: !form.hasStages && !form.sowFile,
    stages: form.hasStages && (form.stages.length === 0 || form.stages.some(stageMissing)),
  }
  const step2Missing = {
    budgetHours: !form.budgetHours || Number(form.budgetHours) <= 0,
    periodStart: !form.periodStart,
    periodEnd: !form.periodEnd,
  }
  const step3Missing = {
    hoursPool: form.maintenanceEnabled && (!form.maintenanceHoursPool || Number(form.maintenanceHoursPool) <= 0),
    durationMonths:
      form.maintenanceEnabled && (!form.maintenanceDurationMonths || Number(form.maintenanceDurationMonths) <= 0),
  }
  const step1Valid = !Object.values(step1Missing).some(Boolean)
  const step2Valid = !Object.values(step2Missing).some(Boolean)
  const step3Valid = !Object.values(step3Missing).some(Boolean)
  const touched = (s) => touchedSteps.includes(s)

  function goNext() {
    setTouchedSteps((prev) => [...new Set([...prev, step])])
    if (step === 0 && !step1Valid) return
    if (step === 1 && !step2Valid) return
    if (step === 2 && !step3Valid) return
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  async function handleFinish() {
    setTouchedSteps([0, 1, 2, 3])
    if (!step1Valid || !step2Valid || !step3Valid || submitting) return
    setSubmitError('')
    setSubmitting(true)
    try {
      await onSubmit({
        clientId: form.clientId,
        client: form.clientName,
        projectName: form.projectName.trim(),
        projectNumber: form.hasStages ? null : form.sowNumber.trim(),
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
        maintenanceEnabled: form.maintenanceEnabled,
        slaTemplate: form.maintenanceEnabled ? form.slaTemplate : null,
        maintenanceTransition: form.maintenanceEnabled ? form.maintenanceTransition : null,
        maintenanceHoursPool: form.maintenanceEnabled ? Number(form.maintenanceHoursPool) : null,
        maintenanceDurationMonths: form.maintenanceEnabled ? Number(form.maintenanceDurationMonths) : null,
        maintenanceSlaTiers:
          form.maintenanceEnabled && form.slaTemplate === 'Custom' ? form.maintenanceSlaTiers : null,
        tasks: form.tasks
          .filter((t) => t.taskName.trim())
          .map((t) => ({
            taskName: t.taskName.trim(),
            role: t.role.trim() || null,
            estimatedHours: Number(t.estimatedHours) || 0,
          })),
      })
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
            <h2 className="modal__title" id="project-wizard-title">New project</h2>
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
              <ClientPicker
                value={form.clientId}
                onChange={(id, client) => {
                  set('clientId', id)
                  set('clientName', client?.clientName ?? '')
                }}
                error={touched(0) && step1Missing.clientId ? 'Pick a client to continue.' : ''}
              />

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
                      <span className="field__req">required</span>
                      <span className="field__hint">.docx (auto-fills Scope) or PDF</span>
                    </label>
                    <input
                      id="wz-sow-file"
                      type="file"
                      accept=".docx,application/pdf,.pdf"
                      className="field__input field__input--file"
                      disabled={!form.clientId}
                      onChange={(e) => onPickSowFile(e.target.files?.[0] ?? null)}
                    />
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
                  </div>
                </>
              )}

              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={form.hasStages}
                  disabled={!form.clientId}
                  onChange={(e) => toggleHasStages(e.target.checked)}
                />
                Has stages?
              </label>

              {form.hasStages && (
                <div className="stage-list">
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
                        disabled={form.stages.length === 1}
                        title={form.stages.length === 1 ? 'A project with stages needs at least one' : 'Remove stage'}
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
                Optional — estimated hours per task. Actual hours and deviation are calculated later against Entries.
              </p>
              {form.tasks.length > 0 && (
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
                              className="field__input"
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
                    {form.tasks.length > 0 && (
                      <tfoot>
                        <tr>
                          <td colSpan={2}>Total</td>
                          <td className="col-num">{tasksTotalHours}</td>
                          <td />
                        </tr>
                      </tfoot>
                    )}
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
                disabled={submitting}
                whileTap={!submitting ? { scale: 0.97 } : undefined}
              >
                {submitting ? <span className="spinner" aria-hidden="true" /> : null}
                {submitting ? 'Saving…' : 'Finish'}
              </motion.button>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
