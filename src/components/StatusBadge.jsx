import { Check, X } from 'lucide-react'

/**
 * Insignia de estado de una entrada.
 * @param {{ status: 'Approved'|'Rejected' }} props
 */
export function StatusBadge({ status }) {
  const approved = status === 'Approved'
  return (
    <span className={`badge ${approved ? 'badge--ok' : 'badge--no'}`}>
      {approved ? (
        <Check size={12} strokeWidth={3} />
      ) : (
        <X size={12} strokeWidth={3} />
      )}
      {status}
    </span>
  )
}
