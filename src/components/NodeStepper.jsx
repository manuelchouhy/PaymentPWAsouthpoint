import { motion } from 'framer-motion'
import { Check } from 'lucide-react'
import { formatHours } from '../lib/format'

/**
 * Mini-grafo horizontal del proceso de billing: Approved → Invoiced →
 * Collected → Paid. Nodos circulares conectados por aristas de 1px — la
 * arista se tiñe de cyan cuando el flujo ya la atravesó. Reemplaza las 4
 * cards de estado por una representación que evoca el logo Southpoint sin
 * repetirlo.
 */
export function NodeStepper({
  approvedHours,
  invoicedHours,
  collectedHours,
  paidHours,
}) {
  const billedHours = invoicedHours + collectedHours + paidHours

  const stages = [
    { key: 'approved', label: 'Approved', hint: 'Billable universe', value: approvedHours },
    { key: 'invoiced', label: 'Invoiced', hint: invoicedHours > 0 ? 'Invoices issued' : 'No invoices', value: invoicedHours },
    { key: 'collected', label: 'Collected', hint: collectedHours > 0 ? 'Collected from client' : 'No collections', value: collectedHours },
    { key: 'paid', label: 'Paid', hint: paidHours > 0 ? 'Paid to contractor' : 'No payments', value: paidHours },
  ]

  // El nodo "activo" es la etapa más avanzada con horas > 0 — todo lo
  // anterior con horas queda "completado" (el flujo ya pasó); lo que sigue,
  // "pendiente" (todavía no llegó).
  let lastActiveIdx = -1
  stages.forEach((stage, i) => {
    if (stage.value > 0) lastActiveIdx = i
  })

  return (
    <section className="node-stepper" aria-label="Billing progress">
      <div className="node-stepper__header">
        <span className="node-stepper__title">Billing process</span>
        <span className="node-stepper__totals">
          <span className="node-stepper__totals-num">
            {formatHours(billedHours)}{' '}
            <span className="node-stepper__totals-of">of</span>{' '}
            {formatHours(approvedHours)}
          </span>
          <span className="node-stepper__totals-unit">h billed</span>
        </span>
      </div>

      <ol className="node-stepper__row">
        {stages.map((stage, i) => {
          const state =
            i < lastActiveIdx ? 'done' : i === lastActiveIdx ? 'active' : 'idle'
          const edgeState = i > 0 && i <= lastActiveIdx ? 'done' : 'idle'
          return (
            <li key={stage.key} className={`node-stepper__item node-stepper__item--${state}`}>
              {i > 0 && (
                <span
                  className={`node-stepper__edge node-stepper__edge--${edgeState}`}
                  aria-hidden="true"
                />
              )}
              <motion.span
                className="node-stepper__node"
                aria-hidden="true"
                initial={false}
                animate={{ scale: state === 'active' ? [1, 1.08, 1] : 1 }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              >
                {state === 'done' && <Check size={13} strokeWidth={2.5} />}
              </motion.span>
              <span className="node-stepper__label">{stage.label}</span>
              <span className="node-stepper__value">
                {formatHours(stage.value)}
                <span className="node-stepper__value-unit">h</span>
              </span>
              <span className="node-stepper__hint">{stage.hint}</span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
