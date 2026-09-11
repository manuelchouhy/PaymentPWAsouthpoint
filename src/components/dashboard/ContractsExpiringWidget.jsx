import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, ChevronRight } from 'lucide-react'
import { contractStatus, daysRemaining } from '../../lib/projectsData'
import { api } from '../../lib/api'
import { ContractBadge } from '../ContractBadge'
import { formatDate } from '../../lib/format'

/**
 * Widget "Contracts expiring" (FR-08). Top 5 contratos por proximidad de
 * vencimiento, con link directo a la grilla.
 *
 * Si el Dashboard le pasa `projects` (ya filtrados por Cliente/Proyecto), usa esa lista
 * y NO fetchea: así el widget respeta el filtro del Dashboard. En ese modo el Dashboard
 * controla el estado de carga con la prop `loading` (mientras filterData no cargó, para no
 * mostrar "No contracts" con la lista todavía vacía). Sin la prop `projects` (montado
 * suelto) fetchea todos los proyectos como antes.
 *
 * @param {{ limit?: number, projects?: Array, loading?: boolean }} props
 */
export function ContractsExpiringWidget({ limit = 5, projects: projectsProp, loading: loadingProp = false }) {
  const [fetched, setFetched] = useState(null)
  const [fetchLoading, setFetchLoading] = useState(projectsProp == null)

  useEffect(() => {
    // Con projects provistos por el Dashboard no se fetchea (la lista ya viene filtrada).
    if (projectsProp != null) return
    let cancelled = false
    setFetchLoading(true)
    api.projects.list()
      .then((projects) => !cancelled && setFetched(projects))
      .catch(() => !cancelled && setFetched([]))
      .finally(() => !cancelled && setFetchLoading(false))
    return () => {
      cancelled = true
    }
  }, [projectsProp])

  // En modo controlado (projects provisto) el loading lo dice el Dashboard; en modo suelto,
  // el fetch propio.
  const loading = projectsProp != null ? loadingProp : fetchLoading
  const source = projectsProp ?? fetched ?? []
  // Solo los que tienen contrato, por proximidad de vencimiento.
  const top = useMemo(
    () =>
      source
        .filter((p) => p.contractExpirationDate)
        .sort((a, b) => a.contractExpirationDate.localeCompare(b.contractExpirationDate))
        .slice(0, limit),
    [source, limit],
  )

  return (
    <section className="dash-widget" aria-label="Contracts expiring">
      <div className="dash-widget__head">
        <span className="dash-widget__title">
          <CalendarClock size={15} aria-hidden="true" />
          Contracts expiring
        </span>
        <Link to="/projects" className="dash-widget__link">
          View all <ChevronRight size={14} aria-hidden="true" />
        </Link>
      </div>

      {loading ? (
        <p className="dash-widget__empty">Loading…</p>
      ) : top.length === 0 ? (
        <p className="dash-widget__empty">No contracts expiring soon.</p>
      ) : (
        <ul className="dash-widget__list">
          {top.map((p) => {
            const days = daysRemaining(p.contractExpirationDate)
            return (
              <li key={p.id} className="dash-widget__row">
                <div className="dash-widget__row-main">
                  <span className="dash-widget__row-name">{p.projectName}</span>
                  <span className="dash-widget__row-meta">
                    {p.client} · expires {formatDate(p.contractExpirationDate)}
                  </span>
                </div>
                <div className="dash-widget__row-right">
                  <span className="dash-widget__row-days">
                    {days < 0 ? `${Math.abs(days)} d overdue` : `${days} d`}
                  </span>
                  <ContractBadge status={contractStatus(days)} />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
