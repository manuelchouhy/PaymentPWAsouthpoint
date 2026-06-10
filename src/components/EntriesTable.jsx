import { motion } from 'framer-motion'
import { FileText, StickyNote } from 'lucide-react'
import { Avatar } from './Avatar'
import { Checkbox } from './Checkbox'
import { StatusBadge } from './StatusBadge'
import { BillingBadge } from './BillingBadge'
import { CellPopButton } from './CellPopButton'
import { formatDate, formatHours, formatWeek } from '../lib/format'

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
 *   getInvoice: (id: string|number) => ({ supplierInvoiceNumber: string, status: string } | null)
 * }} props
 */
export function EntriesTable({
  entries,
  selectedIds,
  onToggle,
  onToggleAll,
  headerChecked,
  headerIndeterminate,
  getInvoice,
  onOpenInvoice,
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
            <th scope="col" className="col-user">User</th>
            <th scope="col" className="col-project">Project</th>
            <th scope="col" className="col-client col-optional">Client</th>
            <th scope="col" className="col-task">Task</th>
            <th scope="col" className="col-tasknum col-optional">Task #</th>
            <th scope="col" className="col-pop">Desc.</th>
            <th scope="col" className="col-pop">Notes</th>
            <th scope="col" className="col-date">Date</th>
            <th scope="col" className="col-week col-optional">Week</th>
            <th className="col-num col-hours" scope="col">Hours</th>
            <th scope="col" className="col-status">Status</th>
            <th scope="col" className="col-billing">Billing</th>
            <th scope="col" className="col-invoice">Invoice</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => {
            const invoice = getInvoice(entry.id)
            const isInvoiced = invoice !== null
            const billingStatus = invoice ? invoice.status : 'Pending'
            const selected = selectedIds.has(entry.id)
            const rowClass = [
              selected ? 'is-selected' : '',
              isInvoiced ? 'is-paid' : '',
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
                  if (event.target.closest('.checkbox')) return
                  if (isInvoiced) {
                    onOpenInvoice?.(invoice.invoiceId)
                    return
                  }
                  onToggle(entry.id)
                }}
                title={
                  isInvoiced
                    ? `Ver factura ${invoice.supplierInvoiceNumber}`
                    : undefined
                }
              >
                <td className="col-check">
                  {isInvoiced ? (
                    <Checkbox checked={false} readOnly disabled />
                  ) : (
                    <Checkbox
                      checked={selected}
                      onChange={() => onToggle(entry.id)}
                      ariaLabel={`Seleccionar entrada de ${entry.user} — ${entry.task}`}
                    />
                  )}
                </td>
                <td className="col-user">
                  <span className="user-cell">
                    <Avatar name={entry.user} size="sm" />
                    <span className="user-cell__name" title={entry.user}>
                      {entry.user}
                    </span>
                  </span>
                </td>
                <td className="col-project" title={entry.project}>
                  {entry.project}
                </td>
                <td
                  className="col-client col-optional cell-soft"
                  title={entry.client || undefined}
                >
                  {entry.client || '—'}
                </td>
                <td className="col-task cell-strong" title={entry.task}>
                  {entry.task}
                </td>
                <td className="col-tasknum col-optional cell-mono">
                  {entry.taskNumber || '—'}
                </td>
                <td className="col-pop">
                  <CellPopButton
                    label="Descripción"
                    text={entry.description}
                    icon={FileText}
                  />
                </td>
                <td className="col-pop">
                  <CellPopButton
                    label="Notes"
                    text={entry.notes}
                    icon={StickyNote}
                  />
                </td>
                <td className="col-date cell-mono">{formatDate(entry.date)}</td>
                <td className="col-week col-optional cell-mono">
                  {formatWeek(entry.date)}
                </td>
                <td className="col-num col-hours cell-hours">
                  {formatHours(entry.hours)}
                </td>
                <td className="col-status">
                  <StatusBadge status={entry.status} />
                </td>
                <td className="col-billing">
                  <BillingBadge status={billingStatus} />
                </td>
                <td
                  className="col-invoice cell-mono"
                  title={invoice?.supplierInvoiceNumber ?? undefined}
                >
                  {invoice?.supplierInvoiceNumber ?? '—'}
                </td>
              </motion.tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
