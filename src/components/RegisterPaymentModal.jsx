import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Banknote, X } from 'lucide-react'
import { BANK_METHODS } from '../lib/paymentsData'

function todayISO() {
  const now = new Date()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${mm}-${dd}`
}

function fmtAmount(value) {
  return Number(value || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Modal "Register Payment" (FR-10). Pago al contractor de una invoice Collected.
 *
 * @param {{
 *   invoice: object,
 *   onClose: () => void,
 *   onConfirm: (data) => Promise<void>,
 * }} props
 */
export function RegisterPaymentModal({ invoice, onClose, onConfirm }) {
  const [amount, setAmount] = useState(String(invoice.totalAmount))
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

  const amountNum = Number(amount)
  const amountValid = amount !== '' && Number.isFinite(amountNum) && amountNum > 0
  const dateValid = Boolean(paymentDate)
  // Si es back-dated, la nota es obligatoria (auditoría).
  const noteOk = !isBackDated || notes.trim().length > 0
  const valid = amountValid && dateValid && noteOk

  useEffect(() => {
    firstRef.current?.focus()
    firstRef.current?.select()
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

  async function handleSubmit(event) {
    event.preventDefault()
    setTouched(true)
    if (!valid || submitting) return
    setSubmitError('')
    setSubmitting(true)
    try {
      await onConfirm({
        amountPaid: amountNum,
        paymentDate,
        transferReference: transferReference.trim(),
        bankMethod,
        notes: notes.trim(),
      })
    } catch (error) {
      setSubmitting(false)
      setSubmitError(
        error?.code === 'not_collected'
          ? 'La factura debe estar Collected antes de pagar.'
          : error?.message ?? 'No se pudo registrar el pago.',
      )
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
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-modal-title"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.92, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 12 }}
        transition={{ type: 'spring', damping: 26, stiffness: 320, mass: 0.8 }}
      >
        <div className="modal__head">
          <div>
            <span className="modal__kicker">Payments · Pago al contractor</span>
            <h2 className="modal__title" id="payment-modal-title">
              Register Payment
            </h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>

        <div className="modal__summary">
          <div className="modal__summary-id">
            <span className="modal__summary-user">{invoice.userName}</span>
            <span className="modal__summary-meta">
              {invoice.supplierInvoiceNumber} · Collected
            </span>
          </div>
          <div className="modal__summary-hours">
            <span className="modal__summary-hours-value">${fmtAmount(invoice.totalAmount)}</span>
            <span className="modal__summary-hours-label">Monto</span>
          </div>
        </div>

        <form className="modal__form" onSubmit={handleSubmit} noValidate>
          <div className="modal__form-row">
            <div className="field">
              <label className="field__label" htmlFor="pay-amount">
                Amount paid<span className="field__req">requerido</span>
              </label>
              <input
                id="pay-amount"
                ref={firstRef}
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                className={`field__input${touched && !amountValid ? ' field__input--error' : ''}`}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="pay-date">
                Payment date<span className="field__req">requerido</span>
              </label>
              <input
                id="pay-date"
                type="date"
                max={today}
                className={`field__input${touched && !dateValid ? ' field__input--error' : ''}`}
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
              />
            </div>
          </div>

          <div className="modal__form-row">
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
            <div className="field">
              <label className="field__label" htmlFor="pay-ref">
                Transfer reference<span className="field__opt">recomendado</span>
              </label>
              <input
                id="pay-ref"
                type="text"
                className="field__input"
                value={transferReference}
                onChange={(e) => setTransferReference(e.target.value)}
                placeholder="Ej. TRX-99821"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="pay-notes">
              Notes
              {isBackDated ? (
                <span className="field__req">requerido (back-dated)</span>
              ) : (
                <span className="field__opt">opcional</span>
              )}
            </label>
            <textarea
              id="pay-notes"
              className={`field__input field__textarea${touched && !noteOk ? ' field__input--error' : ''}`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder={isBackDated ? 'Justificá la fecha pasada (auditoría)…' : ''}
            />
            {touched && !noteOk && (
              <span className="field__error">
                La nota es obligatoria para pagos con fecha pasada.
              </span>
            )}
          </div>

          <p className="modal__note">
            <Banknote size={14} aria-hidden="true" />
            Al confirmar, la factura pasa a <strong>Paid</strong>.
            {isBackDated && ' Este pago se marca como back-dated.'}
          </p>

          {submitError && (
            <p className="modal__submit-error" role="alert">
              {submitError}
            </p>
          )}

          <div className="modal__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={submitting}>
              Cancelar
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
              {submitting ? 'Registrando…' : 'Register Payment'}
            </motion.button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}
