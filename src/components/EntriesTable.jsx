import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { ArrowDown, ArrowUp, ChevronsUpDown, FileText, StickyNote } from 'lucide-react'
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

function SortIcon({ sortKey, sort }) {
  if (sort?.key !== sortKey) return <ChevronsUpDown size={13} aria-hidden="true" className="th-sort__icon th-sort__icon--idle" />
  if (sort.dir === 'asc') return <ArrowUp size={13} aria-hidden="true" className="th-sort__icon th-sort__icon--active" />
  return <ArrowDown size={13} aria-hidden="true" className="th-sort__icon th-sort__icon--active" />
}

function SortTh({ sortKey, sort, onSort, className, scope, children }) {
  return (
    <th scope={scope ?? 'col'} className={className}>
      <button type="button" className="th-sort" onClick={() => onSort(sortKey)}>
        {children}
        <SortIcon sortKey={sortKey} sort={sort} />
      </button>
    </th>
  )
}

/**
 * Tabla de entradas de tiempo (vista de escritorio).
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
  justInvoicedIds,
  sort,
  onSort,
}) {
  // Scroll hacia la primera fila recién facturada cuando aparece el resaltado.
  const firstHighlightRef = useRef(null)
  const hasHighlight = justInvoicedIds && justInvoicedIds.size > 0
  useEffect(() => {
    if (hasHighlight && firstHighlightRef.current) {
      firstHighlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [hasHighlight])

  let firstHighlightSeen = false

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
                ariaLabel="Select all visible pending rows"
              />
            </th>
            <SortTh sortKey="user" sort={sort} onSort={onSort} className="col-user">User</SortTh>
            <SortTh sortKey="project" sort={sort} onSort={onSort} className="col-project">Project</SortTh>
            <SortTh sortKey="client" sort={sort} onSort={onSort} className="col-client col-optional">Client</SortTh>
            <SortTh sortKey="task" sort={sort} onSort={onSort} className="col-task">Task</SortTh>
            <th scope="col" className="col-tasknum col-optional">Task #</th>
            <th scope="col" className="col-pop">Desc.</th>
            <th scope="col" className="col-pop">Notes</th>
            <SortTh sortKey="date" sort={sort} onSort={onSort} className="col-date">Date</SortTh>
            <th scope="col" className="col-week col-optional">Week</th>
            <SortTh sortKey="hours" sort={sort} onSort={onSort} className="col-num col-hours">Hours</SortTh>
            <th scope="col" className="col-status">Status</th>
            <SortTh sortKey="billing" sort={sort} onSort={onSort} className="col-billing">Billing</SortTh>
            <th scope="col" className="col-invoice">Invoice</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => {
            const invoice = getInvoice(entry.id)
            const isInvoiced = invoice !== null
            const billingStatus = invoice ? invoice.status : 'Pending'
            const selected = selectedIds.has(entry.id)
            const justInvoiced = Boolean(justInvoicedIds?.has(entry.id))
            const isFirstHighlight = justInvoiced && !firstHighlightSeen
            if (isFirstHighlight) firstHighlightSeen = true
            const rowClass = [
              selected ? 'is-selected' : '',
              isInvoiced ? 'is-paid' : '',
              justInvoiced ? 'row--just-invoiced' : '',
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <motion.tr
                key={entry.id}
                ref={isFirstHighlight ? firstHighlightRef : undefined}
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
                    ? `View invoice ${invoice.spInvoiceNumber ?? invoice.supplierInvoiceNumber ?? ''}`
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
                      ariaLabel={`Select entry for ${entry.user}: ${entry.task}`}
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
                <td
                  className="col-tasknum col-optional cell-mono"
                  title={entry.taskNumber || undefined}
                >
                  {entry.taskNumber || '—'}
                </td>
                <td className="col-pop">
                  <CellPopButton
                    label="Description"
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
                  title={invoice?.spInvoiceNumber ?? invoice?.supplierInvoiceNumber ?? undefined}
                >
                  {invoice?.spInvoiceNumber ?? invoice?.supplierInvoiceNumber ?? '—'}
                </td>
              </motion.tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
