import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { FolderPlus, Save, X } from 'lucide-react'
import { ClientPicker } from './ClientPicker'
import { useScrollLock } from '../lib/useScrollLock'

// Definición de campos (orden, label, tipo). "required" queda resuelto por
// proyecto en requiredKeys() más abajo, no acá — ver por qué.
const FIELDS = [
  { key: 'client', label: 'Client' },
  { key: 'projectName', label: 'Project Name' },
  { key: 'projectNumber', label: 'Project Number' },
  { key: 'contractNumber', label: 'Contract Number' },
  { key: 'contractExpirationDate', label: 'Contract Expiration Date', type: 'date' },
  { key: 'customerName', label: 'Customer Name' },
  { key: 'customerCode', label: 'Customer Code' },
  { key: 'proposalName', label: 'Proposal Name' },
  { key: 'proposalNumber', label: 'Proposal Number' },
  { key: 'approver', label: 'Approver' },
  { key: 'customerManager', label: 'Customer Manager' },
  { key: 'leadDeveloper', label: 'Lead Developer' },
]

const ALWAYS_REQUIRED = ['client', 'projectName']

// 0022_projects_relax_legacy_required_fields.sql aflojó estas tres a
// nullable porque el wizard de Projects and SOW no las pide. Pero un
// proyecto legacy que YA las tenía cargadas (sync de Zoho, alta vieja) no
// puede perderlas por accidente al editar otro campo — quedan requeridas
// solo para el proyecto que las tenía, no globalmente.
const CONDITIONALLY_REQUIRED = ['projectNumber', 'contractNumber', 'contractExpirationDate']

// Un proyecto con clientId ya tiene su cliente resuelto por la FK — el texto
// libre "client" queda de solo lectura (ver el render más abajo), no
// required, y no cuenta para el autofocus del primer campo. Única fuente de
// verdad para esas tres decisiones, en vez de repetir `Boolean(initial?.clientId)`.
function isClientLinked(initial) {
  return Boolean(initial?.clientId)
}

function requiredKeys(initial) {
  const req = new Set(ALWAYS_REQUIRED)
  for (const key of CONDITIONALLY_REQUIRED) {
    if (String(initial?.[key] ?? '').trim()) req.add(key)
  }
  if (isClientLinked(initial)) req.delete('client')
  return req
}

function emptyForm() {
  return Object.fromEntries(FIELDS.map((f) => [f.key, '']))
}

/**
 * Modal de alta / edición de proyecto (FR-07).
 *
 * @param {{
 *   initial?: object | null,   // proyecto a editar (null = alta)
 *   onClose: () => void,
 *   onSubmit: (payload: object) => Promise<void>,
 * }} props
 */
export function ProjectFormModal({ initial = null, onClose, onSubmit }) {
  const isEdit = Boolean(initial)
  const [form, setForm] = useState(() => {
    const base = initial
      ? Object.fromEntries(FIELDS.map((f) => [f.key, initial[f.key] ?? '']))
      : emptyForm()
    // clientId acompaña al texto `client`: para un proyecto SIN cliente vinculado
    // se elige con el ClientPicker y se persiste como override real (E5), que el
    // resolver prioriza sobre el nombre libre.
    return { ...base, clientId: initial?.clientId ?? null }
  })
  const [touched, setTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [dupError, setDupError] = useState(false)
  const dialogRef = useRef(null)
  const firstRef = useRef(null)
  // `client` deja de ser requerido si el proyecto está VINCULADO a un cliente real
  // (form.clientId, vivo): sea porque ya venía linkeado o porque se acaba de
  // vincular con el linker (E5). Una sola fuente para required/missing/isMissing y
  // el badge del label — así no se contradicen (badge "required" con Save activo).
  const required = useMemo(() => {
    const req = requiredKeys(initial)
    if (form.clientId) req.delete('client')
    return req
  }, [initial, form.clientId])
  // El autofocus al abrir debe caer en el primer campo que sea un <input>
  // real — "client" no lo es si está linkeado (ver render más abajo).
  const firstFocusableIndex = useMemo(
    () => FIELDS.findIndex((f) => !(f.key === 'client' && isClientLinked(initial))),
    [initial],
  )

  useScrollLock()

  useEffect(() => {
    firstRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const missing = [...required].filter((k) => !String(form[k] ?? '').trim())
  const valid = missing.length === 0

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
    if (key === 'projectNumber') setDupError(false)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setTouched(true)
    if (!valid || submitting) return
    setSubmitError('')
    setSubmitting(true)
    try {
      const payload = {}
      for (const f of FIELDS) {
        const trimmed = String(form[f.key] ?? '').trim()
        // "client" es `text not null` en la DB (0004_projects.sql, nunca
        // relajada) — a diferencia del resto, no puede mandarse null aunque
        // ya no sea required acá (proyecto linkeado con texto legacy vacío).
        payload[f.key] = f.key === 'client' ? trimmed : trimmed || null
      }
      // Cliente no vinculado: además del nombre, persistir client_id como override
      // real (E5). Sólo cuando el campo es editable acá (no linkeado) — para un
      // proyecto ya vinculado el cliente se maneja desde Clients, no se toca acá.
      if (!isClientLinked(initial) && form.clientId) {
        payload.clientId = form.clientId
      }
      await onSubmit(payload)
    } catch (error) {
      setSubmitting(false)
      if (error?.code === 'duplicate') {
        setDupError(true)
        setSubmitError('That Project Number already exists. Please use a different one.')
      } else {
        setSubmitError(error?.message ?? 'Could not save. Please try again.')
      }
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
        aria-labelledby="project-form-title"
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
            <h2 className="modal__title" id="project-form-title">
              {isEdit ? 'Edit project' : 'New project'}
            </h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form className="modal__form project-form" onSubmit={handleSubmit} noValidate>
          <div className="project-form__grid">
            {FIELDS.map((field, index) => {
              const value = form[field.key] ?? ''
              const isRequired = required.has(field.key)
              const isMissing = isRequired && touched && !String(value).trim()
              const showDup = field.key === 'projectNumber' && dupError
              // El texto libre "Client" quedó de la alta vieja. Un proyecto
              // creado por el wizard tiene clientId (FK real a clients) —
              // dejarlo editable acá lo desincroniza del cliente vinculado
              // (autopopulado de MSA, futuras vistas por cliente, etc.).
              const clientLinked = field.key === 'client' && isClientLinked(initial)
              return (
                <div className="field" key={field.key}>
                  <label className="field__label" htmlFor={clientLinked ? undefined : `pf-${field.key}`}>
                    {field.label}
                    {isRequired && <span className="field__req">required</span>}
                  </label>
                  {clientLinked ? (
                    <div className="field__input" style={{ color: 'var(--text-soft)' }}>
                      {String(value).trim() ? value : <span className="field__hint">no client name on file</span>}{' '}
                      <span className="field__hint">linked client, edit from Clients</span>
                    </div>
                  ) : (
                    <input
                      id={`pf-${field.key}`}
                      ref={index === firstFocusableIndex ? firstRef : undefined}
                      type={field.type === 'date' ? 'date' : 'text'}
                      className={`field__input${isMissing || showDup ? ' field__input--error' : ''}`}
                      value={value}
                      onChange={(e) => setField(field.key, e.target.value)}
                      onBlur={() => setTouched(true)}
                      autoComplete="off"
                      aria-invalid={isMissing || showDup}
                    />
                  )}
                  {isMissing && <span className="field__error">This field is required.</span>}
                </div>
              )
            })}
          </div>

          {/* Linker opcional (E5): además del nombre libre de arriba, vincular el
              proyecto a un cliente REAL setea client_id, el override que el resolver
              prioriza (más robusto que el match por nombre). Al vincular, el nombre
              libre deja de ser requerido (el link ya provee el cliente); el texto de
              arriba no se toca. Sólo para proyectos no vinculados; uno ya vinculado
              se maneja desde Clients. */}
          {!isClientLinked(initial) && (
            <div className="project-form__link">
              <ClientPicker
                id="pf-client-link"
                label="Link to a client record"
                required={false}
                showMsaHint={false}
                disabled={submitting}
                value={form.clientId}
                onChange={(id) => setForm((prev) => ({ ...prev, clientId: id }))}
              />
              <p className="field__hint">
                Optional. Links this project to a client record for billing
                (client_id, which the resolver prefers over the free-text name). When
                linked, the Client name above is no longer required.
              </p>
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
              {submitting ? (
                <span className="spinner" aria-hidden="true" />
              ) : isEdit ? (
                <Save size={16} strokeWidth={2.2} aria-hidden="true" />
              ) : (
                <FolderPlus size={16} strokeWidth={2.2} aria-hidden="true" />
              )}
              {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create project'}
            </motion.button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}
