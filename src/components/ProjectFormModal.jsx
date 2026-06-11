import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { FolderPlus, Save, X } from 'lucide-react'

// Definición de campos (orden, label, requerido, tipo).
const FIELDS = [
  { key: 'client', label: 'Client', required: true },
  { key: 'projectName', label: 'Project Name', required: true },
  { key: 'projectNumber', label: 'Project Number', required: true },
  { key: 'contractNumber', label: 'Contract Number', required: true },
  { key: 'contractExpirationDate', label: 'Contract Expiration Date', required: true, type: 'date' },
  { key: 'customerName', label: 'Customer Name' },
  { key: 'customerCode', label: 'Customer Code' },
  { key: 'proposalName', label: 'Proposal Name' },
  { key: 'proposalNumber', label: 'Proposal Number' },
  { key: 'approver', label: 'Approver' },
  { key: 'customerManager', label: 'Customer Manager' },
  { key: 'leadDeveloper', label: 'Lead Developer' },
]

const REQUIRED = FIELDS.filter((f) => f.required).map((f) => f.key)

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
    if (!initial) return emptyForm()
    return Object.fromEntries(FIELDS.map((f) => [f.key, initial[f.key] ?? '']))
  })
  const [touched, setTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [dupError, setDupError] = useState(false)
  const dialogRef = useRef(null)
  const firstRef = useRef(null)

  useEffect(() => {
    firstRef.current?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const missing = REQUIRED.filter((k) => !String(form[k] ?? '').trim())
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
      for (const f of FIELDS) payload[f.key] = String(form[f.key] ?? '').trim() || null
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
        initial={{ opacity: 0, scale: 0.94, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ type: 'spring', damping: 26, stiffness: 320, mass: 0.8 }}
      >
        <div className="modal__head">
          <div>
            <span className="modal__kicker">Projects &amp; Contracts</span>
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
              const isMissing = field.required && touched && !String(value).trim()
              const showDup = field.key === 'projectNumber' && dupError
              return (
                <div className="field" key={field.key}>
                  <label className="field__label" htmlFor={`pf-${field.key}`}>
                    {field.label}
                    {field.required && <span className="field__req">required</span>}
                  </label>
                  <input
                    id={`pf-${field.key}`}
                    ref={index === 0 ? firstRef : undefined}
                    type={field.type === 'date' ? 'date' : 'text'}
                    className={`field__input${isMissing || showDup ? ' field__input--error' : ''}`}
                    value={value}
                    onChange={(e) => setField(field.key, e.target.value)}
                    onBlur={() => setTouched(true)}
                    autoComplete="off"
                    aria-invalid={isMissing || showDup}
                  />
                  {isMissing && <span className="field__error">This field is required.</span>}
                </div>
              )
            })}
          </div>

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
