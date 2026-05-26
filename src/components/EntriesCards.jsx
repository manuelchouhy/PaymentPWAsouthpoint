import { motion } from 'framer-motion'
import { Avatar } from './Avatar'
import { Checkbox } from './Checkbox'
import { StatusBadge } from './StatusBadge'
import { PaymentBadge } from './PaymentBadge'
import { formatDate, formatHours } from '../lib/format'

const cardVariants = {
  hidden: { opacity: 0, y: 12 },
  show: (i) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: 0.05 + i * 0.04 },
  }),
}

/**
 * Lista de entradas en formato tarjeta (vista móvil).
 */
export function EntriesCards({ entries, selectedIds, onToggle, getPayment }) {
  return (
    <ul className="cards">
      {entries.map((entry, index) => {
        const payment = getPayment(entry.id)
        const isPaid = payment !== null
        const selected = selectedIds.has(entry.id)
        const cardClass = [
          'card',
          selected ? 'is-selected' : '',
          isPaid ? 'is-paid' : '',
        ]
          .filter(Boolean)
          .join(' ')
        return (
          <motion.li
            key={entry.id}
            custom={index}
            initial="hidden"
            animate="show"
            variants={cardVariants}
          >
            <div
              className={cardClass}
              role={isPaid ? undefined : 'button'}
              tabIndex={isPaid ? -1 : 0}
              aria-pressed={isPaid ? undefined : selected}
              aria-disabled={isPaid || undefined}
              aria-label={
                isPaid
                  ? `Entrada ya pagada de ${entry.user}: ${entry.task}`
                  : `Entrada de ${entry.user}: ${entry.task}, ${formatHours(entry.hours)} horas`
              }
              onClick={() => {
                if (isPaid) return
                onToggle(entry.id)
              }}
              onKeyDown={(event) => {
                if (isPaid) return
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onToggle(entry.id)
                }
              }}
            >
              <div className="card__top">
                {isPaid ? (
                  <Checkbox checked={false} disabled />
                ) : (
                  <Checkbox checked={selected} readOnly />
                )}
                <Avatar name={entry.user} size="md" />
                <div className="card__id">
                  <span className="card__user">{entry.user}</span>
                  <span className="card__project">{entry.project}</span>
                </div>
                <span className="card__hours">
                  {formatHours(entry.hours)}
                  <span className="card__hours-unit">h</span>
                </span>
              </div>

              <div className="card__body">
                <p className="card__task">{entry.task}</p>
                <p className="card__desc">{entry.description}</p>
                {entry.notes && <p className="card__notes">{entry.notes}</p>}
              </div>

              {isPaid && (
                <div className="card__payment">
                  <div className="card__payment-row">
                    <span className="card__payment-label">Invoice</span>
                    <span className="card__payment-value">{payment.invoiceNumber}</span>
                  </div>
                  {payment.transactionNumber && (
                    <div className="card__payment-row">
                      <span className="card__payment-label">Transaction</span>
                      <span className="card__payment-value">{payment.transactionNumber}</span>
                    </div>
                  )}
                </div>
              )}

              <div className="card__foot">
                <span className="card__date">{formatDate(entry.date)}</span>
                <div className="card__foot-badges">
                  <PaymentBadge paid={isPaid} />
                  <StatusBadge status={entry.status} />
                </div>
              </div>
            </div>
          </motion.li>
        )
      })}
    </ul>
  )
}
