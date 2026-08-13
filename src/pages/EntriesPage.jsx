import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'
import { api } from '../lib/api'
import { formatDate, formatWeek } from '../lib/format'
import { useEntryFilters, applyEntryFilters } from '../lib/useEntryFilters'
import { MultiSelectDropdown } from '../components/MultiSelectDropdown'

const PAGE_SIZE = 100

// null = sin clasificar. El triage es 100% manual (ver PRD, "Entries"): ninguna
// hora llega con allocation puesta.
const ALLOCATION_LABELS = {
  bill_to_client: { label: 'bill to client', cls: 'badge--invoiced' },
  overage: { label: 'overage', cls: 'badge--no' },
  sp_internal: { label: 'SP internal', cls: 'badge--pending' },
}

export function EntriesPage() {
  const [entries, setEntries] = useState([])
  const [invoices, setInvoices] = useState([])
  const [status, setStatus] = useState('loading')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const { filters, toggleValue, setField, clear, isActive } = useEntryFilters()

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    Promise.all([api.timeEntries.list(), api.invoices.list()])
      .then(([entryRows, invoiceRows]) => {
        if (cancelled) return
        setEntries(entryRows)
        setInvoices(invoiceRows)
        setStatus('ready')
      })
      .catch((error) => {
        if (cancelled) return
        console.error('No se pudieron cargar las horas:', error)
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // id de entry -> factura, para resolver Billing status sin recorrer las
  // facturas por cada fila.
  const invoiceByEntryId = useMemo(() => {
    const map = new Map()
    for (const invoice of invoices) {
      for (const entryId of invoice.entryIds ?? []) map.set(String(entryId), invoice)
    }
    return map
  }, [invoices])

  const options = useMemo(
    () => ({
      contractors: [...new Set(entries.map((e) => e.user).filter(Boolean))].sort(),
      clients: [...new Set(entries.map((e) => e.client).filter(Boolean))].sort(),
      projects: [...new Set(entries.map((e) => e.project).filter(Boolean))].sort(),
    }),
    [entries],
  )

  const visible = useMemo(() => {
    const filtered = applyEntryFilters(entries, filters, invoiceByEntryId)
    // Las sin clasificar primero SIEMPRE — son las que hay que triagear, y si
    // se mezclaran con las ya clasificadas se perderían de vista. Dentro de
    // cada grupo, la más reciente primero.
    return [...filtered].sort((a, b) => {
      const aPending = a.allocation == null
      const bPending = b.allocation == null
      if (aPending !== bPending) return aPending ? -1 : 1
      return (b.date ?? '').localeCompare(a.date ?? '')
    })
  }, [entries, filters, invoiceByEntryId])

  // Al cambiar los filtros se vuelve a la primera tanda: mantener el "ver más"
  // acumulado de la búsqueda anterior mostraría un conteo que no se pidió.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [filters])

  const page = visible.slice(0, visibleCount)
  const unallocatedCount = visible.filter((e) => e.allocation == null).length

  return (
    <>
      <motion.header
        className="masthead"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="masthead__top">
          <span className="masthead__kicker">Hour triage</span>
          <span className="masthead__rule" aria-hidden="true" />
        </div>
        <h1 className="masthead__title">Entries</h1>
        <p className="masthead__sub">
          Every logged hour, classified by hand. Unallocated hours come first — nothing is
          classified automatically.
        </p>
      </motion.header>

      {status === 'loading' && <p className="state__hint">Loading entries…</p>}

      {status === 'error' && (
        <div className="state state--error">
          <AlertTriangle size={28} strokeWidth={1.8} />
          <h2 className="state__title">Could not load entries</h2>
        </div>
      )}

      {status === 'ready' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: 0.05 }}>
          <section className="filterbar" aria-label="Filters">
            <div className="filterbar__head">
              <span className="filterbar__title">Filters</span>
            </div>
            <div className="filterbar__controls">
              <MultiSelectDropdown
                label="Client"
                options={options.clients}
                selected={filters.clients}
                onToggle={(v) => toggleValue('clients', v)}
              />
              <MultiSelectDropdown
                label="Project"
                options={options.projects}
                selected={filters.projects}
                onToggle={(v) => toggleValue('projects', v)}
              />
              <MultiSelectDropdown
                label="Contractor"
                options={options.contractors}
                selected={filters.contractors}
                onToggle={(v) => toggleValue('contractors', v)}
              />
              <div className="filterfield">
                <span className="filterfield__label">Week</span>
                <input
                  type="number"
                  min="1"
                  max="53"
                  className="filterfield__input"
                  value={filters.week}
                  onChange={(e) => setField('week', e.target.value)}
                />
              </div>
              {isActive && (
                <button type="button" className="btn btn--ghost filterbar__clear" onClick={clear}>
                  Clear
                </button>
              )}
            </div>
          </section>

          <div className="toolbar">
            <span className="toolbar__count">
              {visible.length} {visible.length === 1 ? 'entry' : 'entries'}
              {unallocatedCount > 0 && ` · ${unallocatedCount} unallocated`}
            </span>
          </div>

          {visible.length === 0 ? (
            <div className="empty">No entries to display.</div>
          ) : (
            <>
              <div className="table-wrap table-wrap--scroll">
                <table className="table proj-table">
                  <thead>
                    <tr>
                      <th scope="col">User</th>
                      <th scope="col">Project</th>
                      <th scope="col">Client</th>
                      <th scope="col">Task</th>
                      <th scope="col">Date</th>
                      <th scope="col">Week</th>
                      <th scope="col" className="col-num">Hours</th>
                      <th scope="col">Status</th>
                      <th scope="col">Allocation</th>
                      <th scope="col">Billing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.map((entry) => {
                      const allocation = entry.allocation ? ALLOCATION_LABELS[entry.allocation] : null
                      const billingStatus = invoiceByEntryId.get(String(entry.id))?.status ?? 'Pending'
                      return (
                        <tr key={entry.id}>
                          <td>{entry.user}</td>
                          <td className="cell-strong">{entry.project || '—'}</td>
                          <td className="cell-soft">{entry.client || '—'}</td>
                          <td className="cell-soft">{entry.task || '—'}</td>
                          <td className="cell-mono">{entry.date ? formatDate(entry.date) : '—'}</td>
                          <td className="cell-mono">{entry.date ? formatWeek(entry.date) : '—'}</td>
                          <td className="col-num cell-mono">{entry.hours}</td>
                          <td>{entry.status}</td>
                          <td>
                            {allocation ? (
                              <span className={`badge ${allocation.cls}`}>{allocation.label}</span>
                            ) : (
                              <span className="badge badge--pending">— unallocated —</span>
                            )}
                          </td>
                          <td className="cell-soft">{billingStatus}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {visibleCount < visible.length && (
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
                  >
                    Show more ({visible.length - visibleCount} left)
                  </button>
                </div>
              )}
            </>
          )}
        </motion.div>
      )}
    </>
  )
}
