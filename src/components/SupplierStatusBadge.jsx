import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from 'lucide-react'

/**
 * Badge de estado de Supplier Contract (FR-14).
 *   Active (verde) · Expiring Soon (amarillo) · Critical (naranja) ·
 *   Expired (rojo) · Renewal in Progress (azul)
 */
const CONFIG = {
  Active: { cls: 'badge--active', Icon: CheckCircle2, label: 'Active' },
  'Expiring Soon': { cls: 'badge--expiring', Icon: Clock, label: 'Expiring Soon' },
  Critical: { cls: 'badge--critical', Icon: ShieldAlert, label: 'Critical' },
  Expired: { cls: 'badge--expired', Icon: XCircle, label: 'Expired' },
  'Renewal in Progress': { cls: 'badge--collected', Icon: RefreshCw, label: 'Renewal' },
}

export function SupplierStatusBadge({ status = 'Active' }) {
  const { cls, Icon, label } = CONFIG[status] ?? CONFIG.Active
  return (
    <span className={`badge ${cls}`}>
      <Icon size={12} strokeWidth={2.4} />
      {label}
    </span>
  )
}
