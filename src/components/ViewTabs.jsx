/**
 * Selector de vistas (tabs) arriba de la grilla — FR-04.
 * "Pendientes de facturar" (default) y "Todas", cada una con su contador en vivo.
 *
 * @param {{
 *   active: 'pending' | 'all',
 *   onChange: (value: 'pending' | 'all') => void,
 *   pendingCount: number,
 *   allCount: number,
 * }} props
 */
export function ViewTabs({ active, onChange, pendingCount, allCount }) {
  const tabs = [
    { key: 'pending', label: 'Pending to bill', count: pendingCount },
    { key: 'all', label: 'All', count: allCount },
  ]

  return (
    <div className="viewtabs" role="tablist" aria-label="Billing view">
      {tabs.map((tab) => {
        const selected = active === tab.key
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={selected}
            className={`viewtabs__tab${selected ? ' is-active' : ''}`}
            onClick={() => onChange(tab.key)}
          >
            <span className="viewtabs__label">{tab.label}</span>
            <span className="viewtabs__count">{tab.count}</span>
          </button>
        )
      })}
    </div>
  )
}
