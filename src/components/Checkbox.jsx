import { useEffect, useRef } from 'react'
import { Check, Minus } from 'lucide-react'

/**
 * Checkbox con estilo propio. Mantiene un <input> nativo real como fuente de
 * accesibilidad. En modo `readOnly` se renderiza sólo la caja visual (útil
 * cuando el control real es el contenedor, como en las tarjetas móviles).
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

  if (readOnly || disabled) {
    return <span className={wrapClass}>{box}</span>
  }

  return (
    <span className={wrapClass}>
      <input
        ref={inputRef}
        type="checkbox"
        className="checkbox__input"
        checked={checked}
        onChange={(event) => onChange?.(event.target.checked)}
        aria-label={ariaLabel}
      />
      {box}
    </span>
  )
}
