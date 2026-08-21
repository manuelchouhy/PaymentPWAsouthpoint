import { useEffect, useRef } from 'react'
import { Check, Minus } from 'lucide-react'

/**
 * Checkbox con estilo propio. Mantiene un <input> nativo real como fuente de
 * accesibilidad.
 *
 * - `readOnly`: se renderiza SÓLO la caja visual, sin <input>. Para cuando el
 *   control real es el contenedor (p. ej. una tarjeta o fila clickeable): el
 *   checkbox es decorativo y el <input> duplicaría el control.
 * - `disabled`: sí se renderiza el <input> (deshabilitado). Es un control real
 *   pero no interactuable, y debe seguir expuesto al árbol de accesibilidad
 *   con su rol, nombre y estado — no colapsar a una caja muda.
 */
export function Checkbox({
  checked = false,
  indeterminate = false,
  onChange,
  ariaLabel,
  readOnly = false,
  disabled = false,
}) {
  const inputRef = useRef(null)

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate && !checked
    }
  }, [indeterminate, checked])

  const on = checked || indeterminate
  const wrapClass = [
    'checkbox',
    on ? 'checkbox--on' : '',
    disabled ? 'checkbox--disabled' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const box = (
    <span className="checkbox__box" aria-hidden="true">
      {checked ? (
        <Check size={13} strokeWidth={3} />
      ) : indeterminate ? (
        <Minus size={13} strokeWidth={3} />
      ) : null}
    </span>
  )

  if (readOnly) {
    return <span className={wrapClass}>{box}</span>
  }

  return (
    <span className={wrapClass}>
      <input
        ref={inputRef}
        type="checkbox"
        className="checkbox__input"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.checked)}
        aria-label={ariaLabel}
      />
      {box}
    </span>
  )
}
