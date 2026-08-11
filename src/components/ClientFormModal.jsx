import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { UserPlus2, X } from 'lucide-react'

const TEXT_FIELDS = [
  { key: 'clientName', label: 'Client Name', required: true },
  { key: 'email', label: 'Email', required: false, type: 'email' },
  { key: 'domain', label: 'Domain', required: false },
  { key: 'primaryContactName', label: 'Primary Contact Name', required: true },
  { key: 'primaryContactEmail', label: 'Primary Contact Email', required: true, type: 'email' },
]
const REQUIRED = ['clientName', 'primaryContactName', 'primaryContactEmail']

function emptyForm() {
  return { clientName: '', email: '', domain: '', primaryContactName: '', primaryContactEmail: '' }
}

/**
 * Modal de alta de Client (módulo nuevo, reunión de requerimientos 2026-08-05).
 * Solo alta — no hay edición pedida todavía.
 *
 * @param {{ onClose: () => void, onSubmit: (payload, msaFile: File) => Promise<void> }} props
 */
export function ClientFormModal({ onClose, onSubmit }) {
  const [form, setForm] = useState(emptyForm)
  const [msaFile, setMsaFile] = useState(null)
  const [msaError, setMsaError] = useState('')
  const [touched, setTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const dialogRef = useRef(null)
  const firstRef = useRef(null)

  function onPickMsa(file) {
    setMsaError('')
    if (!file) {
      setMsaFile(null)
      return
    }
    if (file.type !== 'application/pdf') {
      setMsaError('The MSA must be a PDF.')
      setMsaFile(null)
      return
    }
    if (file.size > 20 * 1024 * 1024) {
      setMsaError('The MSA cannot exceed 20 MB.')
      setMsaFile(null)
      return
    }
    setMsaFile(file)
  }

  useEffect(() => {
    firstRef.current?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const missing = REQUIRED.filter((k) => !String(form[k] ?? '').trim())
  const valid = missing.length === 0 && Boolean(msaFile)

  function set(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setTouched(true)
    if (!valid || submitting) return
    setSubmitError('')
    setSubmitting(true)
    try {
      await onSubmit(
        {
          clientName: form.clientName.trim(),
          email: form.email.trim(),
          domain: form.domain.trim(),
          primaryContactName: form.primaryContactName.trim(),
          primaryContactEmail: form.primaryContactEmail.trim(),
        },
        msaFile,
      )
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
        className="modal modal--form"
        role="dialog"
        aria-modal="true"
        aria-labelledby="client-form-title"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="modal__head">
          <div>
            <span className="modal__kicker">Clients</span>
            <h2 className="modal__title" id="client-form-title">New client</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form className="modal__form project-form" onSubmit={handleSubmit} noValidate>
          <div className="project-form__grid">
            {TEXT_FIELDS.map((field, index) => {
              const value = form[field.key] ?? ''
              const isMissing = field.required && touched && !String(value).trim()
              return (
                <div className="field" key={field.key}>
                  <label className="field__label" htmlFor={`client-${field.key}`}>
                    {field.label}
                    {field.required && <span className="field__req">required</span>}
                  </label>
                  <input
                    id={`client-${field.key}`}
                    ref={index === 0 ? firstRef : undefined}
                    type={field.type === 'email' ? 'email' : 'text'}
                    className={`field__input${isMissing ? ' field__input--error' : ''}`}
                    value={value}
                    onChange={(e) => set(field.key, e.target.value)}
                    onBlur={() => setTouched(true)}
                    autoComplete="off"
                  />
                  {isMissing && <span className="field__error">This field is required.</span>}
                </div>
              )
            })}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="client-msa">
              MSA
              <span className="field__req">required</span>
              <span className="field__hint">PDF · max 20 MB</span>
            </label>
            <input
              id="client-msa"
              type="file"
              accept="application/pdf,.pdf"
              className="field__input field__input--file"
              onChange={(e) => onPickMsa(e.target.files?.[0] ?? null)}
            />
            {msaFile && <span className="field__filename">{msaFile.name}</span>}
            {touched && !msaFile && !msaError && (
              <span className="field__error">The MSA file is required.</span>
            )}
            {msaError && <span className="field__error">{msaError}</span>}
          </div>

          {submitError && (
            <p className="modal__submit-error" role="alert">{submitError}</p>
          )}

          <div className="modal__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <motion.button type="submit" className="btn btn--pay"
              disabled={!valid || submitting}
              whileTap={valid && !submitting ? { scale: 0.97 } : undefined}>
              {submitting ? <span className="spinner" aria-hidden="true" /> : <UserPlus2 size={16} strokeWidth={2.2} />}
              {submitting ? 'Saving…' : 'Create client'}
            </motion.button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}
