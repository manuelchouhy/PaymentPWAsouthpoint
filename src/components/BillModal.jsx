import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, FileText, X } from 'lucide-react'
import { Avatar } from './Avatar'
import { formatHours } from '../lib/format'
import { CURRENCIES, getCurrencySymbol } from '../lib/currenciesData'
import { contractStatus, daysRemaining } from '../lib/projectsData'
import { api } from '../lib/api'
import { useScrollLock } from '../lib/useScrollLock'

// Fecha de hoy en formato ISO YYYY-MM-DD (para el default del date picker).
function todayISO() {
  const now = new Date()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${mm}-${dd}`
}

/**
 * Modal "Emitir factura" (FR-05). Reemplaza al modal de pago: en lugar de
 * registrar invoice + transaction juntos, EMITE una factura (status Invoiced).
 *
 * @param {{
 *   user: string,
 *   entries: import('../lib/data').TimeEntry[],
 *   hours: number,
 *   remainingHours?: number,
 *   onClose: () => void,
 *   onConfirm: (data: { supplierInvoiceNumber: string, invoiceDate: string, totalAmount: number, notes: string }) => Promise<void>,
 * }} props
 */
export function BillModal({ user, entries, hours, remainingHours = 0, onClose, onConfirm }) {
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(todayISO)
  const [currency, setCurrency] = useState('USD')
  const [totalAmount, setTotalAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [touched, setTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [contractWarnings, setContractWarnings] = useState([])

  const dialogRef = useRef(null)
  const firstFieldRef = useRef(null)

  const invoiceValid = supplierInvoiceNumber.trim().length > 0
  const dateValid = Boolean(invoiceDate)
  const amountNumber = Number(totalAmount)
  const amountValid = totalAmount !== '' && Number.isFinite(amountNumber) && amountNumber > 0
  const formValid = invoiceValid && dateValid && amountValid

  const estimatedLabel = useMemo(
    () => (amountValid ? `${getCurrencySymbol(currency)}${amountNumber.toFixed(2)}` : '—'),
    [amountValid, amountNumber, currency],
  )

  useScrollLock()

  useEffect(() => {
    firstFieldRef.current?.focus()
  }, [])

  useEffect(() => {
    const names = new Set(entries.map((e) => e.project).filter(Boolean))
    if (names.size === 0) return
    api.projects.list()
      .then((all) => {
        const warnings = []
        for (const p of all) {
          if (!names.has(p.projectName)) continue
          const days = daysRemaining(p.contractExpirationDate)
          const status = contractStatus(days)
          if (status === 'Expired' || status === 'Critical' || status === 'Expiring Soon') {
            warnings.push({
              id: p.id,
              projectName: p.projectName,
              contractNumber: p.contractNumber,
              days,
              status,
            })
          }
        }
        setContractWarnings(warnings)
      })
      .catch(() => {})
  }, [entries])

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
    if (!formValid || submitting) {
      if (!invoiceValid) firstFieldRef.current?.focus()
      return
    }
    setSubmitError('')
    setSubmitting(true)
    try {
      await onConfirm({
        supplierInvoiceNumber: supplierInvoiceNumber.trim(),
        invoiceDate,
        currency,
        totalAmount: amountNumber,
        notes: notes.trim(),
      })
    } catch (error) {
      setSubmitting(false)
      setSubmitError(
        error?.message ?? 'Could not issue the invoice. Please try again.',
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
        aria-labelledby="bill-modal-title"
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="modal__head">
          <div>
            <span className="modal__kicker">Contractor billing</span>
            <h2 className="modal__title" id="bill-modal-title">
              Issue invoice
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
              {' · '}
              amount {estimatedLabel}
            </span>
          </div>
          <div className="modal__summary-hours">
            <span className="modal__summary-hours-value">{formatHours(hours)}</span>
            <span className="modal__summary-hours-label">Hours</span>
          </div>
        </div>

        {/* Umbral 0.05: por debajo, formatHours redondea a "0.0" — sin epsilon,
            un residuo float al seleccionar todo mostraría "0.0 more...". */}
        {remainingHours >= 0.05 && (
          <p className="modal__note" role="status">
            <AlertTriangle size={14} aria-hidden="true" />
            {formatHours(remainingHours)} more pending hours of {user} are not
            included in this invoice.
          </p>
        )}

        {contractWarnings.length > 0 && (
          <div className="modal__contract-warnings">
            {contractWarnings.map((w) => (
              <div
                key={w.id}
                className={`modal__contract-warning modal__contract-warning--${w.status === 'Expired' ? 'expired' : 'expiring'}`}
                role="alert"
              >
                <AlertTriangle size={14} aria-hidden="true" className="modal__contract-warning-icon" />
                <span>
                  <strong>{w.projectName}</strong>
                  {w.contractNumber ? ` · ${w.contractNumber}` : ''}
                  {': '}
                  {w.status === 'Expired'
                    ? `Contract expired ${Math.abs(w.days)} day${Math.abs(w.days) === 1 ? '' : 's'} ago`
                    : `Contract ${w.status.toLowerCase()} · expires in ${w.days} day${w.days === 1 ? '' : 's'}`}
                </span>
              </div>
            ))}
          </div>
        )}

        <form className="modal__form" onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label className="field__label" htmlFor="supplier-invoice-number">
              SouthPointLabs invoice number
              <span className="field__req">required</span>
            </label>
            <input
              id="supplier-invoice-number"
              ref={firstFieldRef}
              className={`field__input${
                touched && !invoiceValid ? ' field__input--error' : ''
              }`}
              value={supplierInvoiceNumber}
              onChange={(event) => setSupplierInvoiceNumber(event.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="Ej. FA-0001-00012345"
              autoComplete="off"
              aria-invalid={touched && !invoiceValid}
            />
            {touched && !invoiceValid && (
              <span className="field__error">
                Please enter the SouthPointLabs invoice number.
              </span>
            )}
          </div>

          <div className="modal__form-row">
            <div className="field">
              <label className="field__label" htmlFor="invoice-date">
                Invoice date
                <span className="field__req">required</span>
              </label>
              <input
                id="invoice-date"
                type="date"
                className={`field__input${
                  touched && !dateValid ? ' field__input--error' : ''
                }`}
                value={invoiceDate}
                onChange={(event) => setInvoiceDate(event.target.value)}
                aria-invalid={touched && !dateValid}
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="bill-currency">Currency</label>
              <select
                id="bill-currency"
                className="field__input"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.code} – {c.name}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="total-amount">
                Total amount
                <span className="field__req">required</span>
              </label>
              <input
                id="total-amount"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                className={`field__input${
                  touched && !amountValid ? ' field__input--error' : ''
                }`}
                value={totalAmount}
                onChange={(event) => setTotalAmount(event.target.value)}
                // Sin esto, el navegador muestra su propio globo de validación
                // nativo (en el idioma del SO/navegador, ej. español, aunque
                // la UI esté en inglés) — la validación real es la nuestra,
                // mostrada más abajo vía field__error.
                onInvalid={(event) => event.preventDefault()}
                placeholder="0.00"
                aria-invalid={touched && !amountValid}
              />
            </div>
          </div>
          {touched && !amountValid && (
            <span className="field__error">
              Please enter a valid amount greater than zero.
            </span>
          )}

          <div className="field">
            <label className="field__label" htmlFor="invoice-notes">
              Notes
              <span className="field__opt">optional</span>
            </label>
            <textarea
              id="invoice-notes"
              className="field__input field__textarea"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Invoice details or reference…"
              rows={3}
            />
          </div>

          <p className="modal__note">
            <FileText size={14} aria-hidden="true" />
            The invoice is issued with status <strong>Invoiced</strong>. Collection and
            contractor payment are subsequent steps.
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
              disabled={!formValid || submitting}
              whileTap={formValid && !submitting ? { scale: 0.97 } : undefined}
            >
              {submitting ? (
                <span className="spinner" aria-hidden="true" />
              ) : (
                <FileText size={16} strokeWidth={2.2} aria-hidden="true" />
              )}
              {submitting ? 'Issuing…' : 'Issue invoice'}
            </motion.button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  )
}
