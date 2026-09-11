import { MultiSelectDropdown } from './MultiSelectDropdown'

/**
 * Barra de filtros compartida (FR-03). Renderiza un MultiSelectDropdown por cada
 * dimensión que se le pasa y, si hay algún filtro activo, un botón Clear. Es tonta:
 * el estado (filters) y las opciones cruzadas (buildFilterOptions) viven en la página;
 * acá sólo se pintan. La usan Billing, Payments y Dashboard para tener la MISMA barra.
 *
 * @param {object} props
 * @param {Array<{key:string, label:string, options:string[]}>} props.dimensions
 *   Dimensiones a mostrar, en orden. `key` es la clave del filtro (contractors,
 *   clients, projects, projectNumbers, statuses, …); `options` sus opciones (ya
 *   cruzadas por buildFilterOptions); `label` el rótulo del dropdown.
 * @param {Record<string, string[]>} props.filters  estado de useEntryFilters.
 * @param {(key:string, value:string)=>void} props.onToggle  toggle de un valor.
 * @param {()=>void} props.onClear  limpia todos los filtros.
 * @param {boolean} props.isActive  hay al menos un filtro activo (muestra Clear).
 * @param {string} [props.title]  rótulo de la barra ("Filters" por defecto).
 */
export function EntryFilterBar({ dimensions, filters, onToggle, onClear, isActive, title = 'Filters' }) {
  return (
    <section className="filterbar" aria-label="Filters">
      <div className="filterbar__head">
        <span className="filterbar__title">{title}</span>
      </div>
      <div className="filterbar__controls">
        {dimensions.map((d) => (
          <MultiSelectDropdown
            key={d.key}
            label={d.label}
            options={d.options}
            selected={filters[d.key] ?? []}
            onToggle={(v) => onToggle(d.key, v)}
          />
        ))}
        {isActive && (
          <button type="button" className="btn btn--ghost filterbar__clear" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
    </section>
  )
}
