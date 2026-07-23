import { AlertTriangle, FileText } from 'lucide-react'
import { motion } from 'framer-motion'
import { formatHours } from '../lib/format'
import { Avatar } from './Avatar'

/**
 * Barra de selección (sticky). Muestra las horas seleccionadas en vivo como
 * pieza visual destacada y contiene el botón Bill (emitir factura).
 *
 * Regla clave: sólo se puede facturar un proveedor por vez. Si la selección
 * abarca varios proveedores, el botón se deshabilita y aparece el aviso.
 */
export function SelectionBar({ count, hours, users, canBill, onBill }) {
  const multipleProviders = users.length > 1

  return (
    <div className={`selbar${count > 0 ? ' selbar--active' : ''}`}>
      <div className="selbar__metric">
        <span className="selbar__label">Selected Hours</span>
        <span className="selbar__value">
          {formatHours(hours)}
          <span className="selbar__unit">h</span>
        </span>
      </div>

      <div className="selbar__detail">
        {count === 0 && (
          <p className="selbar__hint">
            Select rows to add up hours and enable billing.
          </p>
        )}

        {count > 0 && !multipleProviders && (
          <div className="selbar__meta">
            <span className="selbar__provider">
              <Avatar name={users[0]} size="sm" />
              <span className="selbar__user">{users[0]}</span>
            </span>
            <span className="selbar__count">
              {count} {count === 1 ? 'entry ready to bill' : 'entries ready to bill'}
            </span>
          </div>
        )}

        {multipleProviders && (
          <p className="selbar__warn" role="alert">
            <AlertTriangle size={16} strokeWidth={2.4} aria-hidden="true" />
            <span>
              <strong>One contractor at a time.</strong> You have selected rows from{' '}
              {users.length} contractors ({users.join(', ')}). Keep rows from only
              one to proceed with billing.
            </span>
          </p>
        )}
      </div>

      <motion.button
        type="button"
        className="btn btn--pay"
        onClick={onBill}
        disabled={!canBill}
        whileTap={canBill ? { scale: 0.96 } : undefined}
        title={
          multipleProviders
            ? 'Only one contractor can be billed at a time'
            : count === 0
              ? 'Select at least one row'
              : 'Issue invoice'
        }
      >
        <FileText size={16} strokeWidth={2.2} aria-hidden="true" />
        Bill
      </motion.button>
    </div>
  )
}
