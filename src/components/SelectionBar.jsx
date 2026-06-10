import { useEffect } from 'react'
import { AlertTriangle, FileText } from 'lucide-react'
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion'
import { formatHours } from '../lib/format'
import { Avatar } from './Avatar'

/**
 * Número que se anima suavemente al cambiar (spring physics). Mantiene
 * el contrato de display (siempre con 1 decimal vía formatHours).
 */
function AnimatedHours({ value }) {
  const motionValue = useMotionValue(value)
  const spring = useSpring(motionValue, { damping: 28, stiffness: 220, mass: 0.6 })
  const display = useTransform(spring, (latest) => formatHours(latest))

  useEffect(() => {
    motionValue.set(value)
  }, [value, motionValue])

  return <motion.span>{display}</motion.span>
}

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
          <AnimatedHours value={hours} />
          <span className="selbar__unit">h</span>
        </span>
      </div>

      <div className="selbar__detail">
        {count === 0 && (
          <p className="selbar__hint">
            Seleccioná filas para sumar horas y habilitar la facturación.
          </p>
        )}

        {count > 0 && !multipleProviders && (
          <div className="selbar__meta">
            <span className="selbar__provider">
              <Avatar name={users[0]} size="sm" />
              <span className="selbar__user">{users[0]}</span>
            </span>
            <span className="selbar__count">
              {count} {count === 1 ? 'entrada lista para facturar' : 'entradas listas para facturar'}
            </span>
          </div>
        )}

        {multipleProviders && (
          <p className="selbar__warn" role="alert">
            <AlertTriangle size={16} strokeWidth={2.4} aria-hidden="true" />
            <span>
              <strong>Un proveedor por vez.</strong> Seleccionaste filas de{' '}
              {users.length} proveedores ({users.join(', ')}). Dejá filas de uno
              solo para poder facturar.
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
            ? 'Sólo se puede facturar un proveedor por vez'
            : count === 0
              ? 'Seleccioná al menos una fila'
              : 'Emitir factura'
        }
      >
        <FileText size={16} strokeWidth={2.2} aria-hidden="true" />
        Bill
      </motion.button>
    </div>
  )
}
