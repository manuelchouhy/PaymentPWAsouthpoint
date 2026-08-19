import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Save, UserPlus2, X } from 'lucide-react'
import { fileNameFromPath } from '../lib/format'
import { useScrollLock } from '../lib/useScrollLock'

const TEXT_FIELDS = [
  { key: 'clientName', label: 'Client Name', required: true },
  { key: 'email', label: 'Email', required: false, type: 'email' },
  { key: 'domain', label: 'Domain', required: false },
  { key: 'primaryContactName', label: 'Primary Contact Name', required: true },
  { key: 'primaryContactEmail', label: 'Primary Contact Email', required: true, type: 'email' },
  {
    key: 'zohoGroupName',
    label: 'Zoho Group (alias)',
    required: false,
    hint: 'Zoho Project Group that maps hours to this client (e.g. HSS). Leave empty if the group matches the client name.',
  },
]
const REQUIRED = ['clientName', 'primaryContactName', 'primaryContactEmail']

function emptyForm() {
  return { clientName: '', email: '', domain: '', primaryContactName: '', primaryContactEmail: '', zohoGroupName: '' }
}

/**
 * Modal de alta / edición de Client (módulo nuevo, reunión de requerimientos
 * 2026-08-05). En edición, el MSA no es obligatorio — solo se reemplaza si
 * el usuario elige "Replace" (la versión anterior queda en el historial,
 * nunca se borra, ver recordClientMsaVersion).
 *
 * @param {{
 *   initial?: object | null,   // cliente a editar (null = alta)
 *   onClose: () => void,
 *   onSubmit: (payload, msaFile: File | null) => Promise<void>,
 * }} props
 */
export function ClientFormModal({ initial = null, onClose, onSubmit }) {
  const isEdit = Boolean(initial)
  const [form, setForm] = useState(() =>
    initial
      ? {
          clientName: initial.clientName ?? '',
          email: initial.email ?? '',
          domain: initial.domain ?? '',
          primaryContactName: initial.primaryContactName ?? '',
          primaryContactEmail: initial.primaryContactEmail ?? '',
          zohoGroupName: initial.zohoGroupName ?? '',
        }
      : emptyForm(),
  )
  const [msaFile, setMsaFile] = useState(null)
  const [msaError, setMsaError] = useState('')
  const [replacingMsa, setReplacingMsa] = useState(false)
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

  useScrollLock()

  useEffect(() => {
    firstRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const missing = REQUIRED.filter((k) => !String(form[k] ?? '').trim())
  // El MSA es opcional (hay clientes sin MSA: trabajo interno, o alta previa a la
  // firma). Un archivo inválido (msaError) igual bloquea el submit — si no, guardar
  // dejaría el MSA sin aplicar sin avisar que el archivo elegido no sirve.
  const valid = missing.length === 0 && !msaError

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
          zohoGroupName: form.zohoGroupName.trim(),
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
            <h2 className="modal__title" id="client-form-title">
              {isEdit ? `Edit client · ${initial.clientName}` : 'New client'}
            </h2>
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
                    aria-describedby={field.hint ? `client-${field.key}-hint` : undefined}
                  />
                  {field.hint && (
                    <span className="field__hint" id={`client-${field.key}-hint`}>
                      {field.hint}
                    </span>
                  )}
                  {isMissing && <span className="field__error">This field is required.</span>}
                </div>
              )
            })}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="client-msa">
              MSA
              <span className="field__hint">PDF · max 20 MB · optional</span>
            </label>
            {isEdit && initial.msaUrl && !replacingMsa ? (
              <div className="field__input" style={{ justifyContent: 'space-between' }}>
                <span className="field__filename">{fileNameFromPath(initial.msaUrl)}</span>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setReplacingMsa(true)}>
                  Replace
                </button>
              </div>
            ) : (
              <input
                id="client-msa"
                type="file"
                accept="application/pdf,.pdf"
                className="field__input field__input--file"
                onChange={(e) => onPickMsa(e.target.files?.[0] ?? null)}
              />
            )}
            {msaFile && <span className="field__filename">{msaFile.name}</span>}
            {msaError && <span className="field__error">{msaError}</span>}
            {isEdit && replacingMsa && (
              <span className="field__hint">
                Replacing uploads a new version — the previous one stays in history, never deleted.
              </span>
            )}
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
              {submitting ? (
                <span className="spinner" aria-hidden="true" />
              ) : isEdit ? (
                <Save size={16} strokeWidth={2.2} />
              ) : (
                <UserPlus2 size={16} strokeWidth={2.2} />
              )}
              {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create client'}
            </motion.button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}
