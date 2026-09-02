import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, FileText, X } from 'lucide-react'
import { Avatar } from './Avatar'
import { formatHours } from '../lib/format'
import { contractStatus, daysRemaining } from '../lib/projectsData'
import { api } from '../lib/api'
import { useScrollLock } from '../lib/useScrollLock'

/**
 * Modal "Emitir factura AGRUPADA" (slice 03, página Billing). Una sola factura
 * cubre a VARIOS contractors del mismo cliente + proyecto + semana, medida en
 * HORAS. Al emitir se carga SÓLO el SP invoice number (el número de SouthPoint al
 * cliente) + notes; el monto, la fecha, la moneda y el supplier# de cada contractor
 * se cargan al PAGAR (Payments).
 *
 * Es un componente aparte del BillModal single-contractor (que sigue usando la
 * página Time Entries): no comparten API para no acoplar los dos flujos.
 *
 * @param {{
 *   contractors: Array<{ contractor: string, entries: Array<{id:any,hours:number}>, hours: number }>,
 *   client?: ?string,
 *   entries: import('../lib/data').TimeEntry[],
 *   hours: number,
 *   remainingByContractor?: Array<{ contractor: string, remaining: number }>,
 *   onClose: () => void,
 *   onConfirm: (data: { spInvoiceNumber: string, notes: string }) => Promise<void>,
 * }} props
 */
export function GroupedBillModal({
  contractors = [],
  client = null,
  entries,
  hours,
  remainingByContractor = [],
  onClose,
  onConfirm,
}) {
  const [spInvoiceNumber, setSpInvoiceNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [touched, setTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [contractWarnings, setContractWarnings] = useState([])

  const dialogRef = useRef(null)
  const firstFieldRef = useRef(null)

  const invoiceValid = spInvoiceNumber.trim().length > 0

  useScrollLock()

  useEffect(() => {
    firstFieldRef.current?.focus()
  }, [])

  // Clave estable de los proyectos de la selección: `entries` es un array nuevo en
  // cada render del padre, así que depender de él refetcharía projects.list() sin
  // necesidad. Se depende del set de nombres, que sólo cambia si cambia la selección.
  const projectNamesKey = [...new Set(entries.map((e) => e.project).filter(Boolean))]
    .sort()
    .join('|')

  useEffect(() => {
    if (!projectNamesKey) {
      setContractWarnings([])
      return
    }
    const names = new Set(projectNamesKey.split('|'))
    let ignore = false // no setear estado si el modal ya se desmontó
    api.projects.list()
      .then((all) => {
        if (ignore) return
        const warnings = []
        for (const p of all) {
          if (!names.has(p.projectName)) continue
          // Scope por cliente: un proyecto homónimo de OTRO cliente no debe disparar
          // el aviso de esta factura. Sólo se filtra si conocemos el cliente y el
          // proyecto trae el suyo (si falta, no se descarta, para no perder avisos).
          if (client && p.client && p.client !== client) continue
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
    return () => {
      ignore = true
    }
  }, [projectNamesKey, client])

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
        spInvoiceNumber: spInvoiceNumber.trim(),
        notes: notes.trim(),
      })
    } catch (error) {
      setSubmitting(false)
      setSubmitError(error?.message ?? 'Could not issue the invoice. Please try again.')
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
        aria-labelledby="grouped-bill-modal-title"
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
            <h2 className="modal__title" id="grouped-bill-modal-title">
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
          <div className="modal__summary-id">
            <span className="modal__summary-user">
              {contractors.length} contractor{contractors.length === 1 ? '' : 's'}
            </span>
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

        {/* Contractors incluidos en esta factura, con sus horas. */}
        <ul className="modal__contractors">
          {contractors.map((c) => (
            <li key={c.contractor} className="modal__contractor">
              <Avatar name={c.contractor} size="sm" />
              <span className="modal__contractor-name">{c.contractor}</span>
              <span className="modal__contractor-hours">{formatHours(c.hours)} h</span>
            </li>
          ))}
        </ul>

        {/* Horas pendientes por contractor que quedan fuera de esta factura.
            Umbral 0.05: por debajo, formatHours redondea a "0.0". */}
        {remainingByContractor.some((r) => r.remaining >= 0.05) && (
          <div className="modal__note" role="status">
            <AlertTriangle size={14} aria-hidden="true" />
            <span>
              Not included in this invoice:{' '}
              {remainingByContractor
                .filter((r) => r.remaining >= 0.05)
                .map((r) => `${formatHours(r.remaining)} h of ${r.contractor}`)
                .join(', ')}
              .
            </span>
          </div>
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
            <label className="field__label" htmlFor="sp-invoice-number">
              SouthPointLabs invoice number
              <span className="field__req">required</span>
            </label>
            <input
              id="sp-invoice-number"
              ref={firstFieldRef}
              className={`field__input${
                touched && !invoiceValid ? ' field__input--error' : ''
              }`}
              value={spInvoiceNumber}
              onChange={(event) => setSpInvoiceNumber(event.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="Ej. SP-2026-0001"
              autoComplete="off"
              aria-invalid={touched && !invoiceValid}
            />
            {touched && !invoiceValid && (
              <span className="field__error">
                Please enter the SouthPointLabs invoice number.
              </span>
            )}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="grouped-invoice-notes">
              Notes
              <span className="field__opt">optional</span>
            </label>
            <textarea
              id="grouped-invoice-notes"
              className="field__input field__textarea"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Invoice details or reference…"
              rows={3}
            />
          </div>

          <p className="modal__note">
            <FileText size={14} aria-hidden="true" />
            <span>
              The invoice is issued with status <strong>Invoiced</strong>. Each
              contractor&apos;s supplier invoice number, amount and date are loaded when
              paying them in Payments.
            </span>
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
