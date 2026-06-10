import { BadgeCheck, CircleDollarSign, Clock, FileCheck2 } from 'lucide-react'

/**
 * Insignia de Billing Status de una time entry (4 estados).
 *   Pending   → gris   (no está en ninguna factura)
 *   Invoiced  → amarillo
 *   Collected → azul
 *   Paid      → verde
 *
 * @param {{ status: 'Pending'|'Invoiced'|'Collected'|'Paid' }} props
 */
const CONFIG = {
  Pending: { cls: 'badge--pending', Icon: Clock, label: 'Pending' },
  Invoiced: { cls: 'badge--invoiced', Icon: FileCheck2, label: 'Invoiced' },
  Collected: { cls: 'badge--collected', Icon: CircleDollarSign, label: 'Collected' },
  Paid: { cls: 'badge--paid', Icon: BadgeCheck, label: 'Paid' },
}

export function BillingBadge({ status = 'Pending' }) {
  const { cls, Icon, label } = CONFIG[status] ?? CONFIG.Pending
  return (
    <span className={`badge ${cls}`}>
      <Icon size={12} strokeWidth={2.4} />
      {label}
    </span>
  )
}
