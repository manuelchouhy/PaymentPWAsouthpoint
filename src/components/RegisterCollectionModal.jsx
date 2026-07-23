import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertCircle, CircleDollarSign, X } from 'lucide-react'
import { getCurrencySymbol } from '../lib/currenciesData'

function todayISO() {
  const now = new Date()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${mm}-${dd}`
}

function formatAmount(value) {
  return Number(value || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Modal "Register Collection" (FR-09). Registra un cobro (total o parcial)
 * contra una factura. El monto no puede superar el saldo pendiente.
 *
 * @param {{
 *   invoice: object,
 *   outstanding: number,
 *   collected: number,
 *   onClose: () => void,
 *   onConfirm: (data: { amountReceived:number, collectionDate:string, bankReference:string, notes:string }) => Promise<void>,
 * }} props
 */
export function RegisterCollectionModal({ invoice, outstanding, collected, currency = 'USD', onClose, onConfirm }) {
  const sym = getCurrencySymbol(currency)
  const [amount, setAmount] = useState(String(outstanding))
  const [collectionDate, setCollectionDate] = useState(todayISO)
  const [bankReference, setBankReference] = useState('')
  const [notes, setNotes] = useState('')
  const [touched, setTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const dialogRef = useRef(null)
  const firstRef = useRef(null)

  const amountNum = Number(amount)
  const amountValid =
    amount !== '' && Number.isFinite(amountNum) && amountNum > 0 && amountNum <= outstanding + 0.005
  const dateValid = Boolean(collectionDate)
  const valid = amountValid && dateValid

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
        amountReceived: amountNum,
        collectionDate,
        bankReference: bankReference.trim(),
        notes: notes.trim(),
      })
    } catch (error) {
      setSubmitting(false)
      setSubmitError(error?.message ?? 'Could not register the collection.')
    }
  }

  const willComplete = amountValid && amountNum >= outstanding - 0.005
  // Distinto de "!amountValid" a secas: un campo vacío o en blanco no es un
  // sobrepago, así que el mensaje de error específico solo aparece cuando
  // realmente hay un número y ese número excede el saldo pendiente.
  const isOverpayment =
    amount !== '' && Number.isFinite(amountNum) && amountNum > outstanding + 0.005

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
        aria-labelledby="collection-modal-title"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="modal__head">
          <div>
            <span className="modal__kicker">Collections · Payment</span>
            <h2 className="modal__title" id="collection-modal-title">
              Register Collection
            </h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal__summary">
          <div className="modal__summary-id">
            <span className="modal__summary-user">{invoice.supplierInvoiceNumber}</span>
            <span className="modal__summary-meta">
              {invoice.userName} · collected {sym}{formatAmount(collected)} of {sym}{formatAmount(invoice.totalAmount)}
            </span>
          </div>
          <div className="modal__summary-hours">
            <span className="modal__summary-hours-value">{sym}{formatAmount(outstanding)}</span>
            <span className="modal__summary-hours-label">Balance</span>
          </div>
        </div>

        <form className="modal__form" onSubmit={handleSubmit} noValidate>
          <div className="modal__form-row">
            <div className="field">
              <label className="field__label" htmlFor="col-amount">
                Amount received
                <span className="field__req">required</span>
              </label>
              <input
                id="col-amount"
                ref={firstRef}
                type="number"
                inputMode="decimal"
                min="0"
                max={outstanding}
                step="0.01"
                className={`field__input${touched && !amountValid ? ' field__input--error' : ''}`}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onInvalid={(e) => e.preventDefault()}
                aria-invalid={touched && !amountValid}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="col-date">
                Collection date
                <span className="field__req">required</span>
              </label>
              <input
                id="col-date"
                type="date"
                className={`field__input${touched && !dateValid ? ' field__input--error' : ''}`}
                value={collectionDate}
                onChange={(e) => setCollectionDate(e.target.value)}
              />
            </div>
          </div>
          {touched && !amountValid && (
            <span className="field__error">
              Enter an amount between 0 and the outstanding balance ({sym}{formatAmount(outstanding)}).
            </span>
          )}

          <div className="field">
            <label className="field__label" htmlFor="col-ref">
              Bank reference
              <span className="field__opt">optional</span>
            </label>
            <input
              id="col-ref"
              type="text"
              className="field__input"
              value={bankReference}
              onChange={(e) => setBankReference(e.target.value)}
              placeholder="Ej. BBVA-558210"
              autoComplete="off"
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="col-notes">
              Notes
              <span className="field__opt">optional</span>
            </label>
            <textarea
              id="col-notes"
              className="field__input field__textarea"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>

          <p className={`modal__note${isOverpayment ? ' modal__note--error' : ''}`}>
            {isOverpayment ? (
              <AlertCircle size={14} aria-hidden="true" />
            ) : (
              <CircleDollarSign size={14} aria-hidden="true" />
            )}
            {isOverpayment
              ? `Amount exceeds the outstanding balance (${sym}${formatAmount(outstanding)}).`
              : willComplete
                ? 'This collection completes the invoice → moves to Collected.'
                : 'Partial collection: the invoice remains in Partial Collection.'}
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
                <CircleDollarSign size={16} strokeWidth={2.2} aria-hidden="true" />
              )}
              {submitting ? 'Registering…' : 'Register Collection'}
            </motion.button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}
