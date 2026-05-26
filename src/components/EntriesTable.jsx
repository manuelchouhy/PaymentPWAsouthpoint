import { motion } from 'framer-motion'
import { Avatar } from './Avatar'
import { Checkbox } from './Checkbox'
import { StatusBadge } from './StatusBadge'
import { PaymentBadge } from './PaymentBadge'
import { formatDate, formatHours } from '../lib/format'

const rowVariants = {
  hidden: { opacity: 0, y: 8 },
  show: (i) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.36, ease: [0.16, 1, 0.3, 1], delay: 0.04 + i * 0.024 },
  }),
}

/**
 * Tabla de entradas de tiempo (vista de escritorio).
 *
 * @param {{
 *   entries: import('../lib/data').TimeEntry[],
 *   selectedIds: Set<string|number>,
 *   onToggle: (id: string|number) => void,
 *   onToggleAll: () => void,
 *   headerChecked: boolean,
 *   headerIndeterminate: boolean,
 *   getPayment: (id: string|number) => ({ invoiceNumber: string, transactionNumber: ?string } | null)
 * }} props
 */
export function EntriesTable({
  entries,
  selectedIds,
  onToggle,
  onToggleAll,
  headerChecked,
  headerIndeterminate,
  getPayment,
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th className="col-check" scope="col">
              <Checkbox
                checked={headerChecked}
                indeterminate={headerIndeterminate}
                onChange={onToggleAll}
                ariaLabel="Seleccionar todas las filas pendientes visibles"
              />
            </th>
            <th scope="col">User</th>
            <th scope="col">Project</th>
            <th scope="col">Task</th>
            <th scope="col">Description</th>
            <th scope="col">Notes</th>
            <th scope="col">Date</th>
            <th className="col-num" scope="col">Hours</th>
            <th scope="col">Status</th>
            <th scope="col">Payment</th>
            <th scope="col" className="col-narrow">Invoice</th>
            <th scope="col" className="col-narrow">Transaction</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => {
            const payment = getPayment(entry.id)
            const isPaid = payment !== null
            const selected = selectedIds.has(entry.id)
            const rowClass = [
              selected ? 'is-selected' : '',
              isPaid ? 'is-paid' : '',
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <motion.tr
                key={entry.id}
                custom={index}
                initial="hidden"
                animate="show"
                variants={rowVariants}
                className={rowClass}
                onClick={(event) => {
                  if (isPaid) return
                  if (event.target.closest('.checkbox')) return
                  onToggle(entry.id)
                }}
                aria-disabled={isPaid || undefined}
              >
                <td className="col-check">
                  {isPaid ? (
                    <Checkbox checked={false} readOnly disabled />
                  ) : (
                    <Checkbox
                      checked={selected}
                      onChange={() => onToggle(entry.id)}
                      ariaLabel={`Seleccionar entrada de ${entry.user} — ${entry.task}`}
                    />
                  )}
                </td>
                <td>
                  <span className="user-cell">
                    <Avatar name={entry.user} size="sm" />
                    <span className="user-cell__name">{entry.user}</span>
                  </span>
                </td>
                <td>{entry.project}</td>
                <td className="cell-strong">{entry.task}</td>
                <td className="cell-soft">{entry.description}</td>
                <td className="cell-note">{entry.notes || '—'}</td>
                <td className="cell-mono">{formatDate(entry.date)}</td>
                <td className="col-num cell-hours">{formatHours(entry.hours)}</td>
                <td>
                  <StatusBadge status={entry.status} />
                </td>
                <td>
                  <PaymentBadge paid={isPaid} />
                </td>
                <td className="cell-mono col-narrow">
                  {payment?.invoiceNumber ?? '—'}
                </td>
                <td className="cell-mono col-narrow">
                  {payment?.transactionNumber ?? '—'}
                </td>
              </motion.tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
