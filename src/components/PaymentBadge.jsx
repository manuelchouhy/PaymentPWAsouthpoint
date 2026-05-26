import { Check, Clock } from 'lucide-react'

/**
 * Insignia de estado de pago de una time entry.
 * @param {{ paid: boolean }} props
 */
export function PaymentBadge({ paid }) {
  return (
    <span className={`badge ${paid ? 'badge--paid' : 'badge--pending'}`}>
      {paid ? (
        <Check size={12} strokeWidth={3} />
      ) : (
        <Clock size={11} strokeWidth={2.4} />
      )}
      {paid ? 'Pagado' : 'Pendiente'}
    </span>
  )
}
