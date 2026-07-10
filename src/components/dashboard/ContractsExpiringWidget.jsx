import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, ChevronRight } from 'lucide-react'
import { contractStatus, daysRemaining } from '../../lib/projectsData'
import { api } from '../../lib/api'
import { ContractBadge } from '../ContractBadge'
import { formatDate } from '../../lib/format'

/**
 * Widget "Contracts expiring" (FR-08). Top 5 contratos por proximidad de
 * vencimiento, con link directo a la grilla. Listo para montar en el dashboard
 * (que se construye en otra fase).
 *
 * @param {{ limit?: number }} props
 */
export function ContractsExpiringWidget({ limit = 5 }) {
  const [top, setTop] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    api.projects.list()
      .then((projects) => {
        if (cancelled) return
        // Solo los que tienen contrato, por proximidad de vencimiento.
        const withContract = projects.filter((p) => p.contractExpirationDate)
        const sorted = withContract.sort((a, b) =>
          a.contractExpirationDate.localeCompare(b.contractExpirationDate),
        )
        setTop(sorted.slice(0, limit))
      })
      .catch(() => !cancelled && setTop([]))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [limit])

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
