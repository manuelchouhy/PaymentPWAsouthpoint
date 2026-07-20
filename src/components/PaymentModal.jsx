import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Paperclip, Wallet, X } from 'lucide-react'
import { Avatar } from './Avatar'
import { formatHours } from '../lib/format'

/**
 * Modal "Procesar Pago".
 * Muestra el proveedor y las horas seleccionadas, y pide el número de factura
 * (requerido) y el número de transacción (opcional).
 */
export function PaymentModal({ user, entries, hours, onClose, onConfirm }) {
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [transactionNumber, setTransactionNumber] = useState('')
  const [touched, setTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const dialogRef = useRef(null)
  const firstFieldRef = useRef(null)

  const invoiceValid = invoiceNumber.trim().length > 0

  // Foco inicial en el primer campo + bloqueo del scroll de fondo.
  useEffect(() => {
    firstFieldRef.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  // Cerrar con Escape y atrapar el foco dentro del modal.
  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const focusables = dialogRef.current?.querySelectorAll(
        'button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])',
      )
      if (!focusables || focusables.length === 0) return

      const list = [...focusables].filter((el) => !el.disabled)
      const first = list[0]
      const last = list[list.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  async function handleSubmit(event) {
    event.preventDefault()
    setTouched(true)
    if (!invoiceValid || submitting) {
      if (!invoiceValid) firstFieldRef.current?.focus()
      return
    }
    setSubmitError('')
    setSubmitting(true)
    try {
      await onConfirm({
        invoiceNumber: invoiceNumber.trim(),
        transactionNumber: transactionNumber.trim(),
      })
    } catch (error) {
      setSubmitting(false)
      setSubmitError(
        error?.message ?? 'Could not register the payment. Please try again.',
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
        aria-labelledby="modal-title"
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="modal__head">
          <div>
            <span className="modal__kicker">Contractor payment</span>
            <h2 className="modal__title" id="modal-title">
              Process payment
            </h2>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal__summary">
          <Avatar name={user} size="md" />
          <div className="modal__summary-id">
            <span className="modal__summary-user">{user}</span>
            <span className="modal__summary-meta">
              {entries.length}{' '}
              {entries.length === 1 ? 'entry selected' : 'entries selected'}
            </span>
          </div>
          <div className="modal__summary-hours">
            <span className="modal__summary-hours-value">{formatHours(hours)}</span>
            <span className="modal__summary-hours-label">Hours</span>
          </div>
        </div>

        <ul className="modal__entries">
          {entries.map((entry) => (
            <li key={entry.id} className="modal__entry">
              <span className="modal__entry-task">{entry.task}</span>
              <span className="modal__entry-project">{entry.project}</span>
              <span className="modal__entry-hours">
                {formatHours(entry.hours)} h
              </span>
            </li>
          ))}
        </ul>

        <form className="modal__form" onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label className="field__label" htmlFor="invoice-number">
              Invoice Number
              <span className="field__req">required</span>
            </label>
            <input
              id="invoice-number"
              ref={firstFieldRef}
              className={`field__input${
                touched && !invoiceValid ? ' field__input--error' : ''
              }`}
              value={invoiceNumber}
              onChange={(event) => setInvoiceNumber(event.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="Ej. FA-0001-00012345"
              autoComplete="off"
              aria-invalid={touched && !invoiceValid}
            />
            {touched && !invoiceValid && (
              <span className="field__error">
                Please enter the invoice number to continue.
              </span>
            )}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="transaction-number">
              Transaction Number
              <span className="field__opt">optional</span>
            </label>
            <input
              id="transaction-number"
              className="field__input"
              value={transactionNumber}
              onChange={(event) => setTransactionNumber(event.target.value)}
              placeholder="Ej. TRX-99821"
              autoComplete="off"
            />
          </div>

          <p className="modal__note">
            <Paperclip size={14} aria-hidden="true" />
            Files can be attached after the payment has been processed.
          </p>

          {submitError && (
            <p className="modal__submit-error" role="alert">
              {submitError}
            </p>
          )}

          <div className="modal__actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <motion.button
              type="submit"
              className="btn btn--pay"
              disabled={!invoiceValid || submitting}
              whileTap={invoiceValid && !submitting ? { scale: 0.97 } : undefined}
            >
              {submitting ? (
                <span className="spinner" aria-hidden="true" />
              ) : (
                <Wallet size={16} strokeWidth={2.2} aria-hidden="true" />
              )}
              {submitting ? 'Processing…' : 'Process payment'}
            </motion.button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}
