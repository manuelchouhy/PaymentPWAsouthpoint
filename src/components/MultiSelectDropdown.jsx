import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

/**
 * Dropdown de selección múltiple con checkboxes (FR-03).
 *
 * @param {{
 *   label: string,
 *   options: string[],
 *   selected: string[],
 *   onToggle: (value: string) => void,
 *   placeholder?: string,
 * }} props
 */
export function MultiSelectDropdown({
  label,
  options,
  selected,
  onToggle,
  placeholder = 'All',
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(event) {
      if (!ref.current?.contains(event.target)) setOpen(false)
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const count = selected.length
  const valueLabel =
    count === 0
      ? placeholder
      : count === 1
        ? selected[0]
        : `${count} selected`

  return (
    <div className="filterfield msel" ref={ref}>
      <span className="filterfield__label">{label}</span>
      <button
        type="button"
        className={`msel__btn${open ? ' is-open' : ''}${count ? ' has-value' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="msel__value" title={count ? selected.join(', ') : undefined}>
          {valueLabel}
        </span>
        {count > 0 && <span className="msel__badge">{count}</span>}
        <ChevronDown size={15} aria-hidden="true" className="msel__chev" />
      </button>

      {open && (
        <div className="msel__panel" role="listbox" aria-multiselectable="true">
          {options.length === 0 && (
            <div className="msel__empty">No options</div>
          )}
          {options.map((option) => {
            const checked = selected.includes(option)
            return (
              <button
                type="button"
                key={option}
                role="option"
                aria-selected={checked}
                className={`msel__opt${checked ? ' is-checked' : ''}`}
                onClick={() => onToggle(option)}
              >
                <span className="msel__check" aria-hidden="true">
                  {checked && <Check size={13} strokeWidth={3} />}
                </span>
                <span className="msel__opt-label">{option}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
