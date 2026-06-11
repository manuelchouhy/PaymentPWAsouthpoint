import { motion } from 'framer-motion'
import {
  BadgeCheck,
  CheckCircle2,
  Circle,
  CircleDollarSign,
  FileCheck2,
} from 'lucide-react'
import { formatHours } from '../lib/format'

/**
 * Stepper del proceso de billing — 4 etapas con datos reales (no decorativo):
 *  Approved → Invoiced → Collected → Paid.
 * Cada nodo muestra cuántas horas están en ese estado. La barra de progreso
 * representa la fracción facturada (Invoiced + Collected + Paid) sobre el
 * universo aprobado.
 */
export function Stepper({
  approvedHours,
  invoicedHours,
  collectedHours,
  paidHours,
}) {
  const billedHours = invoicedHours + collectedHours + paidHours
  const safeDen = approvedHours > 0 ? approvedHours : 1
  const billedPct = Math.min(100, (billedHours / safeDen) * 100)
  const paidPct = Math.min(100, (paidHours / safeDen) * 100)

  const stages = [
    {
      key: 'approved',
      label: 'Approved',
      hint: 'Billable universe',
      icon: Circle,
      tone: 'approved',
      value: approvedHours,
    },
    {
      key: 'invoiced',
      label: 'Invoiced',
      hint: invoicedHours > 0 ? 'Invoices issued' : 'No invoices',
      icon: FileCheck2,
      tone: 'invoiced',
      value: invoicedHours,
    },
    {
      key: 'collected',
      label: 'Collected',
      hint: collectedHours > 0 ? 'Collected from client' : 'No collections',
      icon: CircleDollarSign,
      tone: 'collected',
      value: collectedHours,
    },
    {
      key: 'paid',
      label: 'Paid',
      hint: paidHours > 0 ? 'Paid to contractor' : 'No payments',
      icon: BadgeCheck,
      tone: 'paid',
      value: paidHours,
    },
  ]

  return (
    <section className="stepper" aria-label="Billing progress">
      <div className="stepper__header">
        <span className="stepper__title">Billing process</span>
        <span className="stepper__totals">
          <span className="stepper__totals-num">
            {formatHours(billedHours)}{' '}
            <span className="stepper__totals-of">of</span>{' '}
            {formatHours(approvedHours)}
          </span>
          <span className="stepper__totals-unit">h billed</span>
        </span>
      </div>

      <div className="stepper__track" role="presentation">
        <div className="stepper__track-bg" />
        <motion.div
          className="stepper__track-selected"
          initial={false}
          animate={{ width: `${billedPct}%` }}
          transition={{ type: 'spring', damping: 28, stiffness: 220 }}
        />
        <motion.div
          className="stepper__track-fill"
          initial={false}
          animate={{ width: `${paidPct}%` }}
          transition={{ type: 'spring', damping: 28, stiffness: 220 }}
        />
      </div>

      <ol className="stepper__nodes stepper__nodes--four">
        {stages.map((stage) => {
          const active = stage.value > 0
          const Icon = active && stage.key !== 'approved' ? CheckCircle2 : stage.icon
          const stateClass = active ? 'is-active' : 'is-idle'
          return (
            <li
              key={stage.key}
              className={`stepper__node ${stateClass} stepper__node--${stage.tone}`}
            >
              <span className="stepper__node-icon" aria-hidden="true">
                <Icon size={15} strokeWidth={2.2} />
              </span>
              <span className="stepper__node-body">
                <span className="stepper__node-label">{stage.label}</span>
                <span className="stepper__node-value">
                  {formatHours(stage.value)}{' '}
                  <span className="stepper__node-unit">h</span>
                </span>
                <span className="stepper__node-hint">{stage.hint}</span>
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
