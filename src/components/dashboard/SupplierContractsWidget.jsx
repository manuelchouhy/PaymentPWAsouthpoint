import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Star, Truck } from 'lucide-react'
import { daysRemaining } from '../../lib/projectsData'
import { displaySupplierStatus, priorityAlertContracts } from '../../lib/supplierContractsData'
import { api } from '../../lib/api'
import { formatDate } from '../../lib/format'

const COUNTED = ['Expired', 'Critical', 'Expiring Soon', 'Active']

/**
 * Widget "Supplier Contracts" (FR-16). Contadores por estado y, si hay
 * proveedores priority en alerta, los destaca arriba con su nombre.
 * Listo para montar en el dashboard (se arma en otra fase).
 */
export function SupplierContractsWidget() {
  const [contracts, setContracts] = useState([])
  const [widestThreshold, setWidestThreshold] = useState(90)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    // Mismo par que SupplierContractsPage: el umbral de "priority en alerta" sale
    // de los ajustes guardados (threshold1Days), no del default fijo (90), para que
    // widget y página coincidan en qué contratos están en alerta.
    Promise.all([
      api.supplierContracts.list(),
      api.supplierContracts.getAlertSettings(),
    ])
      .then(([list, settings]) => {
        if (cancelled) return
        setContracts(list)
        setWidestThreshold(settings?.threshold1Days ?? 90)
      })
      .catch(() => !cancelled && setContracts([]))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  const counts = COUNTED.reduce((acc, s) => ({ ...acc, [s]: 0 }), {})
  for (const c of contracts) {
    const st = displaySupplierStatus(c)
    if (st in counts) counts[st] += 1
  }
  const priority = priorityAlertContracts(contracts, widestThreshold)
  const topDays = priority.length > 0 ? daysRemaining(priority[0].expirationDate) : null

  return (
    <section className="dash-widget" aria-label="Supplier contracts">
      <div className="dash-widget__head">
        <span className="dash-widget__title">
          <Truck size={15} aria-hidden="true" />
          Supplier Contracts
        </span>
        <Link to="/supplier-contracts" className="dash-widget__link">
          View all <ChevronRight size={14} aria-hidden="true" />
        </Link>
      </div>

      {loading ? (
        <p className="dash-widget__empty">Loading…</p>
      ) : (
        <>
          {priority.length > 0 && (
            <div className="dash-widget__priority">
              <Star size={13} aria-hidden="true" className="sc-priority-star" />
              <span className="dash-widget__priority-name">{priority[0].supplierName}</span>
              <span className="dash-widget__priority-meta">
                expires {formatDate(priority[0].expirationDate)} ·{' '}
                {topDays != null && topDays < 0
                  ? `${Math.abs(topDays)} d overdue`
                  : `${topDays} d`}
              </span>
            </div>
          )}
          <div className="dash-counters">
            {COUNTED.map((s) => (
              <div key={s} className={`dash-counter dash-counter--${s.replace(/\s+/g, '-').toLowerCase()}`}>
                <span className="dash-counter__num">{counts[s]}</span>
                <span className="dash-counter__label">{s}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
