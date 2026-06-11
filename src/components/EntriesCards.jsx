import { motion } from 'framer-motion'
import { Avatar } from './Avatar'
import { Checkbox } from './Checkbox'
import { StatusBadge } from './StatusBadge'
import { BillingBadge } from './BillingBadge'
import { formatDate, formatHours, formatWeek } from '../lib/format'

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
export function EntriesCards({
  entries,
  selectedIds,
  onToggle,
  getInvoice,
  onOpenInvoice,
}) {
  return (
    <ul className="cards">
      {entries.map((entry, index) => {
        const invoice = getInvoice(entry.id)
        const isInvoiced = invoice !== null
        const billingStatus = invoice ? invoice.status : 'Pending'
        const selected = selectedIds.has(entry.id)
        const cardClass = [
          'card',
          selected ? 'is-selected' : '',
          isInvoiced ? 'is-paid' : '',
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
              role="button"
              tabIndex={0}
              aria-pressed={isInvoiced ? undefined : selected}
              aria-label={
                isInvoiced
                  ? `View invoice ${invoice.supplierInvoiceNumber} for ${entry.user}`
                  : `Entry for ${entry.user}: ${entry.task}, ${formatHours(entry.hours)} hours`
              }
              onClick={() => {
                if (isInvoiced) {
                  onOpenInvoice?.(invoice.invoiceId)
                  return
                }
                onToggle(entry.id)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  if (isInvoiced) onOpenInvoice?.(invoice.invoiceId)
                  else onToggle(entry.id)
                }
              }}
            >
              <div className="card__top">
                {isInvoiced ? (
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
                <div className="card__meta">
                  {entry.client && (
                    <span className="card__meta-item">
                      <span className="card__meta-label">Client</span>
                      {entry.client}
                    </span>
                  )}
                  {entry.taskNumber && (
                    <span className="card__meta-item">
                      <span className="card__meta-label">Task #</span>
                      {entry.taskNumber}
                    </span>
                  )}
                  <span className="card__meta-item">
                    <span className="card__meta-label">Week</span>
                    {formatWeek(entry.date)}
                  </span>
                </div>
              </div>

              {isInvoiced && (
                <div className="card__payment">
                  <div className="card__payment-row">
                    <span className="card__payment-label">Invoice</span>
                    <span className="card__payment-value">
                      {invoice.supplierInvoiceNumber}
                    </span>
                  </div>
                  <div className="card__payment-row">
                    <span className="card__payment-label">Date</span>
                    <span className="card__payment-value">
                      {formatDate(invoice.invoiceDate)}
                    </span>
                  </div>
                </div>
              )}

              <div className="card__foot">
                <span className="card__date">{formatDate(entry.date)}</span>
                <div className="card__foot-badges">
                  <BillingBadge status={billingStatus} />
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
