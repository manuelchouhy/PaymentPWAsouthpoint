import { useEffect, useState } from 'react'
import { ListFilter, X } from 'lucide-react'
import { MultiSelectDropdown } from './MultiSelectDropdown'

const BILLING_STATUS_OPTIONS = ['Pending', 'Invoiced', 'Collected', 'Paid']

/**
 * Panel de filtros completo de la grilla (FR-03). Los filtros se aplican
 * instantáneamente (sin botón "Aplicar"); el input de semana va con debounce.
 *
 * @param {{
 *   contractors: string[],
 *   clients: string[],
 *   projects: string[],
 *   filters: object,
 *   toggleValue: (key: string, value: string) => void,
 *   setField: (key: string, value: string) => void,
 *   clear: () => void,
 *   isActive: boolean,
 *   counts: { pendientes: number, pagadas: number },
 *   isMobile: boolean,
 * }} props
 */
export function FilterBar({
  contractors,
  clients,
  projects,
  filters,
  toggleValue,
  setField,
  clear,
  isActive,
  counts,
  isMobile,
}) {
  // En mobile el panel arranca colapsado (acordeón) para no comer pantalla.
  const [expanded, setExpanded] = useState(!isMobile)

  // Debounce del input de semana (texto numérico).
  const [weekDraft, setWeekDraft] = useState(filters.week)
  useEffect(() => {
    setWeekDraft(filters.week)
  }, [filters.week])
  useEffect(() => {
    const id = setTimeout(() => {
      if (weekDraft !== filters.week) setField('week', weekDraft)
    }, 250)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekDraft])

  const activeCount =
    filters.contractors.length +
    filters.clients.length +
    filters.projects.length +
    filters.billingStatuses.length +
    (filters.dateFrom ? 1 : 0) +
    (filters.dateTo ? 1 : 0) +
    (filters.week ? 1 : 0)

  const showPanel = !isMobile || expanded

  return (
    <section className="filterbar" aria-label="Filtros">
      <div className="filterbar__head">
        {isMobile ? (
          <button
            type="button"
            className="btn btn--ghost filterbar__toggle"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            <ListFilter size={15} aria-hidden="true" />
            <span>Filtros</span>
            {activeCount > 0 && (
              <span className="filterbar__toggle-badge">{activeCount}</span>
            )}
          </button>
        ) : (
          <span className="filterbar__title">
            <ListFilter size={14} aria-hidden="true" />
            Filtros
          </span>
        )}

        <span className="filterbar__counts" aria-live="polite">
          <strong>{counts.Pending}</strong> pending
          <span className="filterbar__counts-sep">·</span>
          <strong>{counts.Invoiced}</strong> invoiced
          <span className="filterbar__counts-sep">·</span>
          <strong>{counts.Collected}</strong> collected
          <span className="filterbar__counts-sep">·</span>
          <strong>{counts.Paid}</strong> paid
        </span>
      </div>

      {showPanel && (
        <div className="filterbar__controls">
          <MultiSelectDropdown
            label="Contractor"
            options={contractors}
            selected={filters.contractors}
            onToggle={(value) => toggleValue('contractors', value)}
          />
          <MultiSelectDropdown
            label="Client"
            options={clients}
            selected={filters.clients}
            onToggle={(value) => toggleValue('clients', value)}
          />
          <MultiSelectDropdown
            label="Project"
            options={projects}
            selected={filters.projects}
            onToggle={(value) => toggleValue('projects', value)}
          />
          <MultiSelectDropdown
            label="Billing Status"
            options={BILLING_STATUS_OPTIONS}
            selected={filters.billingStatuses}
            onToggle={(value) => toggleValue('billingStatuses', value)}
          />

          <div className="filterfield">
            <span className="filterfield__label">Desde</span>
            <input
              type="date"
              className="filterfield__input"
              value={filters.dateFrom}
              max={filters.dateTo || undefined}
              onChange={(event) => setField('dateFrom', event.target.value)}
            />
          </div>
          <div className="filterfield">
            <span className="filterfield__label">Hasta</span>
            <input
              type="date"
              className="filterfield__input"
              value={filters.dateTo}
              min={filters.dateFrom || undefined}
              onChange={(event) => setField('dateTo', event.target.value)}
            />
          </div>

          <div className="filterfield filterfield--week">
            <span className="filterfield__label">Semana</span>
            <input
              type="number"
              inputMode="numeric"
              min="1"
              max="53"
              placeholder="ej. 23"
              className="filterfield__input"
              value={weekDraft}
              onChange={(event) => setWeekDraft(event.target.value)}
            />
          </div>

          <button
            type="button"
            className="btn btn--ghost filterbar__clear"
            onClick={clear}
            disabled={!isActive}
          >
            <X size={14} aria-hidden="true" />
            Limpiar filtros
          </button>
        </div>
      )}
    </section>
  )
}
