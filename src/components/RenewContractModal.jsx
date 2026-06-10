import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { RefreshCw, X } from 'lucide-react'

const TEXT_FIELDS = [
  { key: 'contractNumber', label: 'New Contract #', type: 'text' },
  { key: 'startDate', label: 'New Start Date', type: 'date' },
  { key: 'expirationDate', label: 'New Expiration Date', type: 'date' },
  { key: 'renewalDate', label: 'New Renewal Date', type: 'date' },
]
const REQUIRED = ['contractNumber', 'startDate', 'expirationDate', 'renewalDate']

/**
 * Modal de renovación de contrato (FR-15). Crea una nueva versión enlazada al
 * contrato actual (parent_contract_id) y archiva el viejo. El PDF es obligatorio.
 *
 * @param {{ contract: object, onClose: () => void, onSubmit: (payload, pdfFile) => Promise<void> }} props
 */
export function RenewContractModal({ contract, onClose, onSubmit }) {
  const [form, setForm] = useState(() => ({
    contractNumber: `${contract.contractNumber ?? ''}-R`,
    startDate: '',
    expirationDate: '',
    renewalDate: '',
  }))
  const [pdfFile, setPdfFile] = useState(null)
  const [pdfError, setPdfError] = useState('')
  const [touched, setTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [dupError, setDupError] = useState(false)
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
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  function onPickPdf(file) {
    setPdfError('')
    if (!file) {
      setPdfFile(null)
      return
    }
    if (file.type !== 'application/pdf') {
      setPdfError('El archivo debe ser un PDF.')
      setPdfFile(null)
      return
    }
    if (file.size > 20 * 1024 * 1024) {
      setPdfError('El PDF no puede superar 20 MB.')
      setPdfFile(null)
      return
    }
    setPdfFile(file)
  }

  const missing = REQUIRED.filter((k) => !String(form[k] ?? '').trim())
  const valid = missing.length === 0 && Boolean(pdfFile)

  function set(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
    if (key === 'contractNumber') setDupError(false)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setTouched(true)
    if (!pdfFile) setPdfError('El PDF de la renovación es obligatorio.')
    if (!valid || submitting) return
    setSubmitError('')
    setSubmitting(true)
    try {
      await onSubmit(
        {
          contractNumber: form.contractNumber.trim(),
          startDate: form.startDate,
          expirationDate: form.expirationDate,
          renewalDate: form.renewalDate,
        },
        pdfFile,
      )
    } catch (error) {
      setSubmitting(false)
      if (error?.code === 'duplicate') {
        setDupError(true)
        setSubmitError('Ese Contract # ya existe. Usá uno distinto.')
      } else {
        setSubmitError(error?.message ?? 'No se pudo renovar.')
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
        aria-labelledby="renew-title"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.94, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ type: 'spring', damping: 26, stiffness: 320, mass: 0.8 }}
      >
        <div className="modal__head">
          <div>
            <span className="modal__kicker">Renovación de contrato</span>
            <h2 className="modal__title" id="renew-title">
              {contract.supplierName}
            </h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>

        <form className="modal__form project-form" onSubmit={handleSubmit} noValidate>
          <p className="modal__note">
            Se archiva el contrato <strong>{contract.contractNumber}</strong> y se crea
            una versión nueva enlazada. El historial se conserva.
          </p>

          <div className="project-form__grid">
            {TEXT_FIELDS.map((field, index) => {
              const value = form[field.key] ?? ''
              const isMissing = touched && !String(value).trim()
              const showDup = field.key === 'contractNumber' && dupError
              return (
                <div className="field" key={field.key}>
                  <label className="field__label" htmlFor={`renew-${field.key}`}>
                    {field.label}
                    <span className="field__req">requerido</span>
                  </label>
                  <input
                    id={`renew-${field.key}`}
                    ref={index === 0 ? firstRef : undefined}
                    type={field.type === 'date' ? 'date' : 'text'}
                    className={`field__input${isMissing || showDup ? ' field__input--error' : ''}`}
                    value={value}
                    onChange={(e) => set(field.key, e.target.value)}
                    onBlur={() => setTouched(true)}
                    autoComplete="off"
                  />
                  {isMissing && <span className="field__error">Campo requerido.</span>}
                </div>
              )
            })}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="renew-pdf">
              New Contract PDF
              <span className="field__req">requerido</span>
            </label>
            <input
              id="renew-pdf"
              type="file"
              accept="application/pdf,.pdf"
              className="field__input field__input--file"
              onChange={(e) => onPickPdf(e.target.files?.[0] ?? null)}
            />
            {pdfFile && <span className="field__filename">{pdfFile.name}</span>}
            {pdfError && <span className="field__error">{pdfError}</span>}
          </div>

          {submitError && (
            <p className="modal__submit-error" role="alert">{submitError}</p>
          )}

          <div className="modal__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={submitting}>
              Cancelar
            </button>
            <motion.button type="submit" className="btn btn--pay"
              disabled={!valid || submitting}
              whileTap={valid && !submitting ? { scale: 0.97 } : undefined}>
              {submitting ? <span className="spinner" aria-hidden="true" />
                : <RefreshCw size={16} strokeWidth={2.2} />}
              {submitting ? 'Renovando…' : 'Renovar contrato'}
            </motion.button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}
