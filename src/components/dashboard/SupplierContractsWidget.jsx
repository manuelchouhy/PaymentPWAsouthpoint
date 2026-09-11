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
 *
 * Los supplier contracts NO tienen cliente en los datos, así que el filtro de Cliente
 * del Dashboard no los toca. Sí responden al filtro de **Contractor**: si el Dashboard
 * pasa `contractorFilter` (nombres elegidos), los contadores/priority se calculan sólo
 * sobre los contratos cuyo supplierName está en esa lista. Vacío/ausente → todos.
 *
 * @param {{ contractorFilter?: string[] }} props
 */
export function SupplierContractsWidget({ contractorFilter }) {
  const [contracts, setContracts] = useState([])
  const [widestThreshold, setWidestThreshold] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    // Los contadores dependen sólo de list(). El umbral de "priority en alerta"
    // (threshold1Days de los ajustes guardados, como SupplierContractsPage) se trae
    // aparte y best-effort: si falla, cae al default 90 sin vaciar el widget.
    api.supplierContracts.list()
      .then((data) => !cancelled && setContracts(data))
      .catch(() => !cancelled && setContracts([]))
      .finally(() => !cancelled && setLoading(false))
    api.supplierContracts.getAlertSettings()
      .then((settings) => !cancelled && setWidestThreshold(settings?.threshold1Days ?? 90))
      .catch(() => !cancelled && setWidestThreshold(90))
    return () => {
      cancelled = true
    }
  }, [])

  // Filtro por Contractor del Dashboard (los supplier contracts no tienen cliente): con
  // nombres elegidos, sólo los proveedores en esa lista; vacío/ausente → todos.
  const scoped =
    contractorFilter?.length ? contracts.filter((c) => contractorFilter.includes(c.supplierName)) : contracts

  const counts = COUNTED.reduce((acc, s) => ({ ...acc, [s]: 0 }), {})
  for (const c of scoped) {
    const st = displaySupplierStatus(c)
    if (st in counts) counts[st] += 1
  }
  // El banner de priority espera a que el umbral guardado cargue (o falle a 90) para
  // no mostrar un contrato "en alerta" con el default y luego esconderlo (flicker).
  // Los contadores no esperan: dependen sólo de list().
  const priority = widestThreshold == null ? [] : priorityAlertContracts(scoped, widestThreshold)
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
