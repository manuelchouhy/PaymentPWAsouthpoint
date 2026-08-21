/**
 * Filtro de semana ISO. Diseño calcado del mockup: prefijo "W" dentro del
 * input cuando hay valor (lee como el token "W30") y "All" como estado vacío
 * (la opción "All" del <select> del mockup). Es presentacional: el valor y el
 * onChange los maneja cada pantalla, así conserva su propia lógica (p. ej. el
 * debounce de FilterBar vs. el set directo de Entries).
 */
export function WeekField({ label = 'Week', value, onChange }) {
  const hasValue = value !== ''
  return (
    <div className="filterfield filterfield--week">
      <span className="filterfield__label">{label}</span>
      <div className="filterfield__affixwrap">
        {hasValue && (
          <span className="filterfield__affix" aria-hidden="true">W</span>
        )}
        <input
          type="number"
          inputMode="numeric"
          min="1"
          max="53"
          placeholder="All"
          className={`filterfield__input${hasValue ? ' filterfield__input--affixed' : ''}`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </div>
  )
}
