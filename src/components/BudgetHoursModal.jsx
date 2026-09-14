import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Save, X } from 'lucide-react'
import { api } from '../lib/api'
import { useScrollLock } from '../lib/useScrollLock'
import { parseBudgetInput } from '../lib/budgetInput'
import { buildBudgetSavePlan } from '../lib/budgetEditorPlan'
import { resolveProjectBudget } from '../lib/projectStageBudget'
import { buildProjectTaskTree } from '../lib/projectTaskTree'
import { mergeProjectTasks } from '../lib/mergeProjectTasks'

/**
 * Editor "Edit Budget Hours" — reemplaza al wizard "Edit SOW & Scope" en el flujo
 * de EDICIÓN. Lo ÚNICO editable son las horas de budget: a nivel proyecto (sin
 * stages) o por stage (+ marcar el stage activo). NO se pueden agregar ni eliminar
 * stages ni tasks; las tasks se muestran de solo lectura, agrupadas por su stage.
 *
 * @param {{ project: object, onClose: () => void, onSubmit: (plan: object) => Promise<void> }} props
 */
export function BudgetHoursModal({ project, onClose, onSubmit }) {
  const [stages, setStages] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [treeTasks, setTreeTasks] = useState([])

  // Inputs editables (strings, como el resto de los forms).
  const [baseBudgetInput, setBaseBudgetInput] = useState(project.baseBudgetHours ?? '')
  const [stageInputs, setStageInputs] = useState({})
  const [activeStageId, setActiveStageId] = useState(project.activeStageId ?? null)

  const [touched, setTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const dialogRef = useRef(null)

  useScrollLock()

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    // Stages (con su budget) para la grilla; tasks (registradas + logueadas de
    // Zoho) solo para mostrarlas read-only bajo su stage. allSettled: si fallan
    // las tasks, la edición de budgets igual funciona; solo los stages son
    // imprescindibles.
    Promise.allSettled([
      Promise.resolve().then(() => api.projects.getStages(project.id)),
      Promise.resolve().then(() => api.projectTasks.list(project.id)),
      Promise.resolve().then(() => api.projectTasks.logged(project.projectName)),
    ]).then(([stagesRes, registeredRes, loggedRes]) => {
      if (cancelled) return
      if (stagesRes.status === 'fulfilled') {
        const loaded = Array.isArray(stagesRes.value) ? stagesRes.value : []
        setStages(loaded)
        setStageInputs(Object.fromEntries(loaded.map((s) => [s.id, s.budgetHours ?? ''])))
      } else {
        console.error('No se pudieron cargar los stages del proyecto:', stagesRes.reason)
        setLoadError('Stages could not be loaded — try reopening this project.')
      }
      const registered = registeredRes.status === 'fulfilled' ? registeredRes.value : []
      const logged = loggedRes.status === 'fulfilled' ? loggedRes.value : []
      setTreeTasks(mergeProjectTasks(registered ?? [], logged ?? []))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [project.id, project.projectName])

  // Un proyecto marcado con stages usa el editor por-stage aunque getStages haya
  // vuelto vacío (dato inconsistente / transitorio): así NUNCA se escribe
  // base_budget_hours en un proyecto cuyo budget vive en sus stages.
  const hasStages = Boolean(project.hasStages) || stages.length > 0

  // Total/activo en vivo: se reusa el mismo resolver que Client Summary, mapeando
  // los inputs actuales a budgets parseados, para que el número que ve el usuario
  // al editar sea exactamente el que se va a guardar.
  const live = useMemo(() => {
    const parsedStages = stages.map((s) => ({
      id: s.id,
      budgetHours: parseBudgetInput(stageInputs[s.id], { allowEmpty: true, allowZero: true }).value,
    }))
    return resolveProjectBudget(
      { baseBudgetHours: parseBudgetInput(baseBudgetInput, { allowEmpty: true, allowZero: true }).value, activeStageId },
      hasStages ? parsedStages : [],
      [],
    )
  }, [stages, stageInputs, baseBudgetInput, activeStageId, hasStages])

  const taskTree = useMemo(() => buildProjectTaskTree(stages, treeTasks), [stages, treeTasks])

  // Validación en vivo: cualquier input inválido bloquea Save.
  const inputError = hasStages
    ? stages.map((s) => parseBudgetInput(stageInputs[s.id], { allowEmpty: true, allowZero: true }).error).find(Boolean) ?? null
    : parseBudgetInput(baseBudgetInput, { allowEmpty: true, allowZero: true }).error
  const valid = !loading && !loadError && !inputError

  function original() {
    return {
      hasStages,
      baseBudgetHours: project.baseBudgetHours ?? null,
      activeStageId: project.activeStageId ?? null,
      stages: stages.map((s) => ({ id: s.id, budgetHours: s.budgetHours ?? null })),
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setTouched(true)
    if (!valid || submitting) return
    const plan = buildBudgetSavePlan(original(), { baseBudgetInput, activeStageId, stageInputs })
    if (plan.error) {
      setSubmitError(plan.error)
      return
    }
    setSubmitError('')
    setSubmitting(true)
    try {
      await onSubmit(plan)
    } catch (error) {
      setSubmitting(false)
      setSubmitError(error?.message ?? 'Could not save. Please try again.')
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
        className="modal modal--form"
        role="dialog"
        aria-modal="true"
        aria-labelledby="budget-modal-title"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="modal__head">
          <div>
            <span className="modal__kicker">Projects and SOW · {project.projectName}</span>
            <h2 className="modal__title" id="budget-modal-title">
              Edit Budget Hours
            </h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form className="modal__form project-form" onSubmit={handleSubmit} noValidate>
          {loading ? (
            <p className="field__hint">Loading…</p>
          ) : loadError ? (
            <p className="modal__submit-error" role="alert">
              {loadError}
            </p>
          ) : hasStages && stages.length === 0 ? (
            <p className="field__hint">
              This project has stages, but none could be listed right now. Try reopening this project.
            </p>
          ) : hasStages ? (
            <>
              <p className="field__hint">
                One budget per stage. The <strong>active</strong> stage’s budget is the project’s
                current budget; the total is the sum of all stages. Stages and tasks come from the
                project — only their hours are editable here.
              </p>
              <table className="budget-stages">
                <thead>
                  <tr>
                    <th>Stage</th>
                    <th>Budget Hours</th>
                    <th>Active</th>
                  </tr>
                </thead>
                <tbody>
                  {stages.map((s) => {
                    const err = touched
                      ? parseBudgetInput(stageInputs[s.id], { allowEmpty: true, allowZero: true }).error
                      : null
                    return (
                      <tr key={s.id}>
                        <td>{s.stageName}</td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            className={`field__input${err ? ' field__input--error' : ''}`}
                            value={stageInputs[s.id] ?? ''}
                            onChange={(e) => setStageInputs((prev) => ({ ...prev, [s.id]: e.target.value }))}
                            onBlur={() => setTouched(true)}
                            aria-label={`Budget hours for ${s.stageName}`}
                            aria-invalid={Boolean(err)}
                          />
                          {err && <span className="field__error">{err}</span>}
                        </td>
                        <td>
                          <input
                            type="radio"
                            name="active-stage"
                            checked={String(activeStageId ?? '') === String(s.id)}
                            onChange={() => setActiveStageId(s.id)}
                            aria-label={`Mark ${s.stageName} as the active stage`}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total (sum of stages)</td>
                    <td>{live.totalBudget ?? '—'}</td>
                    <td>
                      <span className="field__hint">active: {live.activeBudget ?? '—'}</span>
                    </td>
                  </tr>
                </tfoot>
              </table>

              {taskTree.length > 0 && (
                <div className="budget-tasks">
                  <p className="field__hint">Tasks (read-only), grouped by stage:</p>
                  <ul>
                    {taskTree.map((node) => (
                      <li key={node.key}>
                        <strong>{node.label}</strong>
                        {node.tasks?.length ? (
                          <ul>
                            {node.tasks.map((t) => (
                              <li key={t.taskId ?? t.taskName}>{t.taskName}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="field__hint"> — no tasks</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <div className="field">
              <label className="field__label" htmlFor="budget-base">
                Budget Hours
              </label>
              <input
                id="budget-base"
                type="number"
                min="0"
                step="0.5"
                className={`field__input${touched && inputError ? ' field__input--error' : ''}`}
                value={baseBudgetInput}
                onChange={(e) => setBaseBudgetInput(e.target.value)}
                onBlur={() => setTouched(true)}
                aria-invalid={Boolean(touched && inputError)}
              />
              {touched && inputError && <span className="field__error">{inputError}</span>}
            </div>
          )}

          {submitError && (
            <p className="modal__submit-error" role="alert">
              {submitError}
            </p>
          )}

          <div className="modal__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <motion.button
              type="submit"
              className="btn btn--pay"
              disabled={!valid || submitting}
              whileTap={valid && !submitting ? { scale: 0.97 } : undefined}
            >
              {submitting ? <span className="spinner" aria-hidden="true" /> : <Save size={16} strokeWidth={2.2} aria-hidden="true" />}
              {submitting ? 'Saving…' : 'Save changes'}
            </motion.button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}
