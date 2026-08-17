import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { FilePlus2, Save, X } from 'lucide-react'
import { PAYMENT_TERMS, RENEWAL_TYPES } from '../lib/supplierContractsData'
import { useScrollLock } from '../lib/useScrollLock'

const TEXT_FIELDS = [
  { key: 'supplierName', label: 'Supplier', required: true },
  { key: 'contractNumber', label: 'Contract #', required: true },
  { key: 'startDate', label: 'Start Date', required: true, type: 'date' },
  { key: 'expirationDate', label: 'Expiration Date', required: true, type: 'date' },
  { key: 'renewalDate', label: 'Renewal Date', required: true, type: 'date' },
]
const REQUIRED = ['supplierName', 'contractNumber', 'startDate', 'expirationDate', 'renewalDate']

function emptyForm() {
  return {
    supplierName: '',
    contractNumber: '',
    startDate: '',
    expirationDate: '',
    renewalDate: '',
    paymentTerms: PAYMENT_TERMS[1], // Net 30
    renewalType: RENEWAL_TYPES[1], // Auto-notify
    isPrioritySupplier: false,
    weeklyContractedHours: '',
  }
}

/**
 * Modal de alta / edición de Supplier Contract (FR-14). Sin upload de PDF (FR-15).
 *
 * @param {{ initial?: object|null, onClose: () => void, onSubmit: (payload) => Promise<void> }} props
 */
export function SupplierContractFormModal({ initial = null, onClose, onSubmit }) {
  const isEdit = Boolean(initial)
  const [form, setForm] = useState(() => {
    if (!initial) return emptyForm()
    return {
      supplierName: initial.supplierName ?? '',
      contractNumber: initial.contractNumber ?? '',
      startDate: initial.startDate ?? '',
      expirationDate: initial.expirationDate ?? '',
      renewalDate: initial.renewalDate ?? '',
      paymentTerms: initial.paymentTerms ?? PAYMENT_TERMS[1],
      renewalType: initial.renewalType ?? RENEWAL_TYPES[1],
      isPrioritySupplier: Boolean(initial.isPrioritySupplier),
      weeklyContractedHours:
        initial.weeklyContractedHours == null ? '' : String(initial.weeklyContractedHours),
    }
  })
  const [pdfFile, setPdfFile] = useState(null)
  const [pdfError, setPdfError] = useState('')
  const [touched, setTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [dupError, setDupError] = useState(false)
  const dialogRef = useRef(null)
  const firstRef = useRef(null)

  function onPickPdf(file) {
    setPdfError('')
    if (!file) {
      setPdfFile(null)
      return
    }
    if (file.type !== 'application/pdf') {
      setPdfError('The file must be a PDF.')
      setPdfFile(null)
      return
    }
    if (file.size > 20 * 1024 * 1024) {
      setPdfError('The PDF cannot exceed 20 MB.')
      setPdfFile(null)
      return
    }
    setPdfFile(file)
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
  // Coherencia de fechas: Expiration no puede ser anterior a Start (bug
  // reportado — se pudo crear un contrato con Expiration < Start sin aviso).
  const dateOrderValid =
    !form.startDate || !form.expirationDate || form.expirationDate >= form.startDate
  // Opcional: si se completa, tiene que ser un número finito >= 0 (misma
  // regla que el check de la columna en supabase/migrations/0026). Se
  // calcula una sola vez y se reusa tanto para validar como para el payload,
  // así no puede desincronizarse entre las dos lecturas.
  const weeklyHoursTrimmed = String(form.weeklyContractedHours ?? '').trim()
  const weeklyHoursNumber = weeklyHoursTrimmed ? Number(weeklyHoursTrimmed) : null
  const weeklyHoursValid =
    weeklyHoursNumber === null || (Number.isFinite(weeklyHoursNumber) && weeklyHoursNumber >= 0)
  const valid = missing.length === 0 && dateOrderValid && weeklyHoursValid

  function set(key, value) {
    setForm((prev) => {
      const next = { ...prev, [key]: value }
      // Auto-marcar prioridad si el proveedor es southpointlabs.
      if (key === 'supplierName' && /southpoint\s*labs/i.test(value)) {
        next.isPrioritySupplier = true
      }
      return next
    })
    if (key === 'contractNumber') setDupError(false)
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
          supplierName: form.supplierName.trim(),
          contractNumber: form.contractNumber.trim(),
          startDate: form.startDate,
          expirationDate: form.expirationDate,
          renewalDate: form.renewalDate,
          paymentTerms: form.paymentTerms,
          renewalType: form.renewalType,
          isPrioritySupplier: form.isPrioritySupplier,
          weeklyContractedHours: weeklyHoursNumber,
        },
        pdfFile,
      )
    } catch (error) {
      setSubmitting(false)
      if (error?.code === 'duplicate') {
        setDupError(true)
        setSubmitError('That Contract # already exists. Please use a different one.')
      } else {
        setSubmitError(error?.message ?? 'Could not save.')
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
        aria-labelledby="sc-form-title"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="modal__head">
          <div>
            <span className="modal__kicker">Supplier Contracts</span>
            <h2 className="modal__title" id="sc-form-title">
              {isEdit ? 'Edit contract' : 'New contract'}
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
              const showDup = field.key === 'contractNumber' && dupError
              const isExpiration = field.key === 'expirationDate'
              const showDateOrderError = isExpiration && touched && !dateOrderValid
              return (
                <div className="field" key={field.key}>
                  <label className="field__label" htmlFor={`sc-${field.key}`}>
                    {field.label}
                    {field.required && <span className="field__req">required</span>}
                  </label>
                  <input
                    id={`sc-${field.key}`}
                    ref={index === 0 ? firstRef : undefined}
                    type={field.type === 'date' ? 'date' : 'text'}
                    min={isExpiration ? form.startDate || undefined : undefined}
                    className={`field__input${isMissing || showDup || showDateOrderError ? ' field__input--error' : ''}`}
                    value={value}
                    onChange={(e) => set(field.key, e.target.value)}
                    onBlur={() => setTouched(true)}
                    autoComplete="off"
                  />
                  {isMissing && <span className="field__error">This field is required.</span>}
                  {showDateOrderError && (
                    <span className="field__error">Expiration Date cannot be before Start Date.</span>
                  )}
                </div>
              )
            })}

            <div className="field">
              <label className="field__label" htmlFor="sc-paymentTerms">Payment Terms</label>
              <select id="sc-paymentTerms" className="field__input"
                value={form.paymentTerms}
                onChange={(e) => set('paymentTerms', e.target.value)}>
                {PAYMENT_TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="sc-renewalType">Renewal Type</label>
              <select id="sc-renewalType" className="field__input"
                value={form.renewalType}
                onChange={(e) => set('renewalType', e.target.value)}>
                {RENEWAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="sc-weeklyContractedHours">
                Contracted Hours/Week
                <span className="field__hint">optional</span>
              </label>
              <input
                id="sc-weeklyContractedHours"
                type="number"
                min="0"
                step="0.5"
                inputMode="decimal"
                className={`field__input${touched && !weeklyHoursValid ? ' field__input--error' : ''}`}
                value={form.weeklyContractedHours}
                onChange={(e) => set('weeklyContractedHours', e.target.value)}
                onBlur={() => setTouched(true)}
              />
              {touched && !weeklyHoursValid && (
                <span className="field__error">Enter a number of 0 or more.</span>
              )}
            </div>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="sc-pdf">
              Contract PDF
              <span className="field__hint">optional · PDF · max 20 MB</span>
            </label>
            <input
              id="sc-pdf"
              type="file"
              accept="application/pdf,.pdf"
              className="field__input field__input--file"
              onChange={(e) => onPickPdf(e.target.files?.[0] ?? null)}
            />
            {pdfFile && (
              <span className="field__filename">{pdfFile.name}</span>
            )}
            {isEdit && initial?.pdfUrl && !pdfFile && (
              <span className="field__filename field__filename--muted">
                A PDF is already uploaded. Uploading a new one will replace it.
              </span>
            )}
            {pdfError && <span className="field__error">{pdfError}</span>}
          </div>

          <label className="settings-check">
            <input type="checkbox" checked={form.isPrioritySupplier}
              onChange={(e) => set('isPrioritySupplier', e.target.checked)} />
            Mark as Priority Supplier (southpointlabs)
          </label>

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
              {submitting ? <span className="spinner" aria-hidden="true" />
                : isEdit ? <Save size={16} strokeWidth={2.2} />
                  : <FilePlus2 size={16} strokeWidth={2.2} />}
              {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create contract'}
            </motion.button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}
