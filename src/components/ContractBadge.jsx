import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileQuestion,
  ShieldAlert,
  XCircle,
} from 'lucide-react'

/**
 * Badge de estado de contrato (FR-07), calculado desde días restantes.
 *   Expired (rojo) · Critical (naranja) · Expiring Soon (amarillo) ·
 *   Advance Notice (amarillo claro) · Active (verde)
 *
 * @param {{ status: string }} props
 */
const CONFIG = {
  Expired: { cls: 'badge--expired', Icon: XCircle, label: 'Expired' },
  Critical: { cls: 'badge--critical', Icon: ShieldAlert, label: 'Critical' },
  'Expiring Soon': { cls: 'badge--expiring', Icon: AlertTriangle, label: 'Expiring Soon' },
  'Advance Notice': { cls: 'badge--advance', Icon: Clock, label: 'Advance Notice' },
  Active: { cls: 'badge--active', Icon: CheckCircle2, label: 'Active' },
  'No Contract': { cls: 'badge--pending', Icon: FileQuestion, label: 'No Contract' },
}

export function ContractBadge({ status = 'Active' }) {
  const { cls, Icon, label } = CONFIG[status] ?? CONFIG.Active
  return (
    <span className={`badge ${cls}`}>
      <Icon size={12} strokeWidth={2.4} />
      {label}
    </span>
  )
}
