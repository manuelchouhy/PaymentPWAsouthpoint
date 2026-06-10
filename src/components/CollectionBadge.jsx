import { CircleDollarSign, CircleDotDashed, Clock } from 'lucide-react'

/**
 * Badge de Collection Status (FR-09).
 *   Pending Collection → gris · Partial Collection → ámbar · Collected → verde
 *
 * @param {{ status: 'Pending Collection'|'Partial Collection'|'Collected' }} props
 */
const CONFIG = {
  'Pending Collection': { cls: 'badge--pending', Icon: Clock, label: 'Pending' },
  'Partial Collection': { cls: 'badge--invoiced', Icon: CircleDotDashed, label: 'Partial' },
  Collected: { cls: 'badge--paid', Icon: CircleDollarSign, label: 'Collected' },
}

export function CollectionBadge({ status = 'Pending Collection' }) {
  const { cls, Icon, label } = CONFIG[status] ?? CONFIG['Pending Collection']
  return (
    <span className={`badge ${cls}`}>
      <Icon size={12} strokeWidth={2.4} />
      {label}
    </span>
  )
}
