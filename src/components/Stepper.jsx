import { motion } from 'framer-motion'
import { CheckCircle2, Circle, MousePointerClick, Wallet } from 'lucide-react'
import { formatHours } from '../lib/format'

/**
 * Stepper de proceso de billing. Refleja datos reales (no decorativo):
 *  - Aprobadas: horas con status Approved (universo facturable).
 *  - En selección: horas actualmente seleccionadas en la UI.
 *  - Pagadas: horas pagadas (suma de hours de entries presentes en algún payment).
 *
 * El progreso visual se calcula sobre paid / approved.
 */
export function Stepper({ approvedHours, selectedHours, paidHours }) {
  const safeDen = approvedHours > 0 ? approvedHours : 1
  const paidPct = Math.min(100, (paidHours / safeDen) * 100)
  const selectedPct = Math.min(100, (selectedHours / safeDen) * 100)

  const stages = [
    {
      key: 'approved',
      label: 'Aprobadas',
      hint: 'Universo facturable',
      icon: Circle,
      value: approvedHours,
      done: approvedHours > 0,
      active: false,
    },
    {
      key: 'selected',
      label: 'En selección',
      hint: selectedHours > 0 ? 'Listas para pagar' : 'Sin selección activa',
      icon: MousePointerClick,
      value: selectedHours,
      done: false,
      active: selectedHours > 0,
    },
    {
      key: 'paid',
      label: 'Pagadas',
      hint: paidHours > 0 ? `${paidPct.toFixed(0)}% del aprobado` : 'Sin pagos registrados',
      icon: Wallet,
      value: paidHours,
      done: paidHours > 0 && paidHours >= approvedHours,
      active: paidHours > 0,
    },
  ]

  return (
    <section className="stepper" aria-label="Progreso de billing">
      <div className="stepper__header">
        <span className="stepper__title">Proceso de billing</span>
        <span className="stepper__totals">
          <span className="stepper__totals-num">
            {formatHours(paidHours)} <span className="stepper__totals-of">de</span>{' '}
            {formatHours(approvedHours)}
          </span>
          <span className="stepper__totals-unit">h pagadas</span>
        </span>
      </div>

      <div className="stepper__track" role="presentation">
        <div className="stepper__track-bg" />
        <motion.div
          className="stepper__track-fill"
          initial={false}
          animate={{ width: `${paidPct}%` }}
          transition={{ type: 'spring', damping: 28, stiffness: 220 }}
        />
        <motion.div
          className="stepper__track-selected"
          initial={false}
          animate={{
            width: `${Math.max(paidPct, Math.min(100, paidPct + selectedPct))}%`,
          }}
          transition={{ type: 'spring', damping: 28, stiffness: 220 }}
        />
      </div>

      <ol className="stepper__nodes">
        {stages.map((stage) => {
          const Icon = stage.done ? CheckCircle2 : stage.icon
          const stateClass = stage.done
            ? 'is-done'
            : stage.active
              ? 'is-active'
              : 'is-idle'
          return (
            <li key={stage.key} className={`stepper__node ${stateClass}`}>
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
