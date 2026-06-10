import { motion } from 'framer-motion'
import { AlertOctagon, BellOff, RefreshCw } from 'lucide-react'
import { daysRemaining } from '../lib/projectsData'
import { formatDate } from '../lib/format'

/**
 * Banner persistente para proveedores priority (southpointlabs) en alerta (FR-16).
 * No se puede dismissar sin acción concreta (no muestra X). Si hay más de un
 * contrato priority en alerta, muestra el más urgente y un contador del resto.
 *
 * @param {{ contracts: object[], onRenew: (c) => void, onMarkRenewal: (c) => void }} props
 */
export function PriorityContractBanner({ contracts, onRenew, onMarkRenewal }) {
  if (!contracts || contracts.length === 0) return null

  const top = contracts[0]
  const days = daysRemaining(top.expirationDate)
  const extra = contracts.length - 1

  return (
    <motion.div
      className="priority-banner"
      role="alert"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3 }}
    >
      <div className="priority-banner__icon" aria-hidden="true">
        <AlertOctagon size={20} strokeWidth={2.2} />
      </div>
      <div className="priority-banner__body">
        <p className="priority-banner__text">
          <strong>{top.supplierName}</strong> contract expires on{' '}
          {formatDate(top.expirationDate)} —{' '}
          {days < 0
            ? `${Math.abs(days)} days overdue`
            : `${days} days remaining`}
          .
        </p>
        {extra > 0 && (
          <p className="priority-banner__more">
            +{extra} {extra === 1 ? 'otro contrato priority' : 'contratos priority'} en alerta.
          </p>
        )}
      </div>
      <div className="priority-banner__actions">
        <button type="button" className="btn btn--banner-ghost" onClick={() => onMarkRenewal(top)}>
          <BellOff size={15} strokeWidth={2.2} aria-hidden="true" />
          Mark as Renewal in Progress
        </button>
        <button type="button" className="btn btn--banner-solid" onClick={() => onRenew(top)}>
          <RefreshCw size={15} strokeWidth={2.2} aria-hidden="true" />
          Renew now
        </button>
      </div>
    </motion.div>
  )
}
