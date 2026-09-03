import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Banknote, X } from 'lucide-react'
import { BANK_METHODS } from '../lib/paymentsData'
import { useScrollLock } from '../lib/useScrollLock'

function todayISO() {
  const now = new Date()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${mm}-${dd}`
}

/**
 * Modal "Register Payment" (FR-10), modelo en HORAS (slice 04d/05). Pago al contractor,
 * sin monto ni moneda. Sirve para dos casos:
 *  - Pago de un contractor bajo una factura agrupada: `requireSupplierNumber` →
 *    exige el supplier invoice number (contractor → SouthPoint). El resumen (nombre,
 *    factura, horas) lo pasa el llamador vía summaryName/summaryMeta/summaryFigure.
 *  - Overage / sp_internal (sin factura): sin supplier#. Se pasan summary* + el
 *    picker de horas en `extraContent` + un `footerNote` propio.
 *
 * onConfirm recibe: { supplierInvoiceNumber?, paymentDate, transferReference,
 * bankMethod, notes }. El supplierInvoiceNumber sólo va cuando requireSupplierNumber.
 *
 * @param {{
 *   requireSupplierNumber?: boolean,
 *   title?: string,
 *   submitLabel?: string,
 *   extraContent?: import('react').ReactNode,
 *   extraValid?: boolean,
 *   summaryName?: string,
 *   summaryMeta?: string,
 *   summaryFigure?: string,
 *   summaryFigureLabel?: string,
 *   footerNote?: import('react').ReactNode,
 *   onClose: () => void,
 *   onConfirm: (data) => Promise<void>,
 * }} props
 */
export function RegisterPaymentModal({
  requireSupplierNumber = false,
  extraContent,
  extraValid = true,
  title = 'Register Payment',
  submitLabel = 'Register Payment',
  summaryName,
  summaryMeta,
  summaryFigure,
  summaryFigureLabel,
  footerNote,
  onClose,
  onConfirm,
}) {
  const [supplierNumber, setSupplierNumber] = useState('')
  const [paymentDate, setPaymentDate] = useState(todayISO)
  const [transferReference, setTransferReference] = useState('')
  const [bankMethod, setBankMethod] = useState(BANK_METHODS[0])
  const [notes, setNotes] = useState('')
  const [touched, setTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const dialogRef = useRef(null)
  const firstRef = useRef(null)

  const today = todayISO()
  const isBackDated = useMemo(() => paymentDate < today, [paymentDate, today])

  const supplierValid = !requireSupplierNumber || supplierNumber.trim().length > 0
  const dateValid = Boolean(paymentDate)
  const noteOk = !isBackDated || notes.trim().length > 0
  // extraValid: gancho para validez adicional del llamador (p. ej. overage exige
  // ≥1 hora seleccionada). Default true → no afecta el caso por factura.
  const valid = supplierValid && dateValid && noteOk && extraValid

  useScrollLock()

  useEffect(() => {
    firstRef.current?.focus()
    // select() sólo aplica a inputs de texto (el supplier# del pago por-contractor).
    // En el caso overage/sp_internal firstRef apunta al input type=date, donde select()
    // es inválido (no-op o InvalidStateError en algún Chromium) → se omite.
    if (requireSupplierNumber) firstRef.current?.select()
  }, [requireSupplierNumber])

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  async function handleSubmit(event) {
    event.preventDefault()
    setTouched(true)
    if (!valid || submitting) return
    setSubmitError('')
    setSubmitting(true)
    try {
      await onConfirm({
        // El supplier# sólo se manda cuando el caso lo pide (pago por factura). En
        // overage/sp_internal queda undefined (la capa de datos no lo usa).
        supplierInvoiceNumber: requireSupplierNumber ? supplierNumber.trim() : undefined,
        paymentDate,
        transferReference: transferReference.trim(),
        bankMethod,
        notes: notes.trim(),
      })
    } catch (error) {
      setSubmitting(false)
      // El mensaje ya viene legible de la capa de datos (carreras, validación).
      setSubmitError(error?.message ?? 'Could not register the payment.')
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
        className="modal modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-modal-title"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="modal__head">
          <div>
            <span className="modal__kicker">Payments · Contractor Payment</span>
            <h2 className="modal__title" id="payment-modal-title">
              {title}
            </h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal__summary">
          <div className="modal__summary-id">
            <span className="modal__summary-user">{summaryName}</span>
            <span className="modal__summary-meta">{summaryMeta}</span>
          </div>
          <div className="modal__summary-hours">
            <span className="modal__summary-hours-value">{summaryFigure}</span>
            <span className="modal__summary-hours-label">
              {summaryFigureLabel ?? 'Hours to pay'}
            </span>
          </div>
        </div>

        {extraContent}

        <form className="modal__form" onSubmit={handleSubmit} noValidate>
          {requireSupplierNumber && (
            <div className="field">
              <label className="field__label" htmlFor="pay-supplier">
                Supplier invoice number<span className="field__req">required</span>
              </label>
              <input
                id="pay-supplier"
                ref={firstRef}
                type="text"
                className={`field__input${touched && !supplierValid ? ' field__input--error' : ''}`}
                value={supplierNumber}
                onChange={(e) => setSupplierNumber(e.target.value)}
                placeholder="e.g. SUP-2026-0142"
                autoComplete="off"
              />
              {touched && !supplierValid && (
                <span className="field__error">Enter the contractor’s invoice number.</span>
              )}
            </div>
          )}

          <div className="modal__form-row">
            <div className="field">
              <label className="field__label" htmlFor="pay-date">
                Payment date<span className="field__req">required</span>
              </label>
              <input
                id="pay-date"
                ref={requireSupplierNumber ? undefined : firstRef}
                type="date"
                max={today}
                className={`field__input${touched && !dateValid ? ' field__input--error' : ''}`}
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="pay-bank">Bank / method</label>
              <select
                id="pay-bank"
                className="field__input"
                value={bankMethod}
                onChange={(e) => setBankMethod(e.target.value)}
              >
                {BANK_METHODS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="pay-ref">
              Transfer reference<span className="field__opt">recommended</span>
            </label>
            <input
              id="pay-ref"
              type="text"
              className="field__input"
              value={transferReference}
              onChange={(e) => setTransferReference(e.target.value)}
              placeholder="e.g. TRX-99821"
              autoComplete="off"
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="pay-notes">
              Notes
              {isBackDated ? (
                <span className="field__req">required (back-dated)</span>
              ) : (
                <span className="field__opt">optional</span>
              )}
            </label>
            <textarea
              id="pay-notes"
              className={`field__input field__textarea${touched && !noteOk ? ' field__input--error' : ''}`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder={isBackDated ? 'Justify the back-dated payment (audit)…' : ''}
            />
            {touched && !noteOk && (
              <span className="field__error">
                A note is required for back-dated payments.
              </span>
            )}
          </div>

          <p className="modal__note">
            <Banknote size={14} aria-hidden="true" />
            {footerNote ?? (
              <>
                Registers this contractor’s payment. The invoice moves to{' '}
                <strong>Paid</strong> once every contractor is paid.
              </>
            )}
            {isBackDated && ' This payment will be marked as back-dated.'}
          </p>

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
              ) : (
                <Banknote size={16} strokeWidth={2.2} aria-hidden="true" />
              )}
              {submitting ? 'Registering…' : submitLabel}
            </motion.button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}
