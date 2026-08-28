import { Check, X, Clock } from 'lucide-react'

// Estados de aprobación de una entry (vienen de Zoho approval_status). Tres
// variantes: Approved verde, Pending gris/neutral (a la espera), Rejected rojo.
// Un valor inesperado cae a la variante roja, preservando el comportamiento
// previo (todo lo no-Approved se dibujaba como rojo antes de sumar Pending).
const VARIANTS = {
  Approved: { cls: 'badge--ok', Icon: Check },
  Pending: { cls: 'badge--wait', Icon: Clock },
  Rejected: { cls: 'badge--no', Icon: X },
}

/**
 * Insignia de estado de una entrada.
 * @param {{ status: 'Approved'|'Rejected'|'Pending' }} props
 */
export function StatusBadge({ status }) {
  const { cls, Icon } = VARIANTS[status] ?? VARIANTS.Rejected
  return (
    <span className={`badge ${cls}`}>
      <Icon size={12} strokeWidth={3} />
      {status}
    </span>
  )
}
