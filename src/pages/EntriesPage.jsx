import { useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'
import { api } from '../lib/api'
import { formatDate, formatHours, formatWeek } from '../lib/format'
import { useEntryFilters, applyEntryFilters } from '../lib/useEntryFilters'
import { MultiSelectDropdown } from '../components/MultiSelectDropdown'
import { StatusBadge } from '../components/StatusBadge'
import { BillingBadge } from '../components/BillingBadge'

const PAGE_SIZE = 100

const sortedUnique = (values) =>
  [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'))

// null = sin clasificar. El triage es 100% manual (ver PRD, "Entries"): ninguna
// hora llega con allocation puesta.
// Clases propias (definidas en index.css): reusar las de billing/status haría
// que "SP internal" se viera igual que "sin clasificar" y que "bill to client"
// se confundiera con la columna Billing, que significa otra cosa.
const ALLOCATION_LABELS = {
  bill_to_client: { label: 'bill to client', cls: 'badge--alloc-bill' },
  overage: { label: 'overage', cls: 'badge--alloc-overage' },
  sp_internal: { label: 'SP internal', cls: 'badge--alloc-internal' },
}

export function EntriesPage() {
  const { user, can } = useOutletContext()
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [allocationChoice, setAllocationChoice] = useState('bill_to_client')
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState('')
  const [entries, setEntries] = useState([])
  const [invoices, setInvoices] = useState([])
  const [status, setStatus] = useState('loading')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [reloadKey, setReloadKey] = useState(0)
  const { filters, toggleValue, setField, clear, isActive } = useEntryFilters()

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    Promise.all([api.timeEntries.list(), api.invoices.list()])
      .then(([entryRows, invoiceRows]) => {
        if (cancelled) return
        setEntries(entryRows)
        setInvoices(invoiceRows)
        // Los datos se releyeron: una selección armada sobre la tanda anterior
        // puede apuntar a filas que ya se facturaron.
        setSelectedIds(new Set())
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
  }, [reloadKey])

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
      // localeCompare 'es': un .sort() plano manda los acentuados (Álvaro,
      // Ñandú) al final del dropdown, donde nadie los busca.
      contractors: sortedUnique(entries.map((e) => e.user)),
      clients: sortedUnique(entries.map((e) => e.client)),
      projects: sortedUnique(entries.map((e) => e.project)),
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
  // La selección se limpia por el mismo motivo: la barra suma horas sobre lo
  // visible, así que arrastrar filas de otro filtro mostraría "0.0 h · 40
  // entries" y Apply escribiría sobre 40 filas que ya no están en pantalla.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
    setSelectedIds(new Set())
    // El error habla de la selección anterior: dejarlo colgado bajo otra grilla
    // hace desconfiar de allocations que sí se guardaron.
    setApplyError('')
  }, [filters])

  const page = visible.slice(0, visibleCount)
  const unallocatedCount = visible.filter((e) => e.allocation == null).length
  const canAllocate = can('entries.allocate')

  // Una hora ya facturada no se reclasifica: la factura ya salió con esa
  // justificación. Cualquier otra sí, tenga o no allocation puesta —
  // corregir una clasificación mal hecha es parte del triage.
  const isFrozen = (entry) => (invoiceByEntryId.get(String(entry.id))?.status ?? 'Pending') !== 'Pending'
  const selectableOnPage = page.filter((e) => !isFrozen(e))
  const allPageSelected =
    selectableOnPage.length > 0 && selectableOnPage.every((e) => selectedIds.has(e.id))

  function toggleRow(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllOnPage() {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allPageSelected) selectableOnPage.forEach((e) => next.delete(e.id))
      else selectableOnPage.forEach((e) => next.add(e.id))
      return next
    })
  }

  const selectedEntries = visible.filter((e) => selectedIds.has(e.id))
  const selectedHours = selectedEntries.reduce((sum, e) => sum + (Number(e.hours) || 0), 0)

  async function handleApply() {
    // Se manda sólo lo que sigue visible y reclasificable, no el Set crudo: es
    // lo que el usuario ve sumado en la barra.
    const ids = selectedEntries.filter((e) => !isFrozen(e)).map((e) => e.id)
    if (!ids.length || applying) return
    setApplying(true)
    setApplyError('')
    try {
      const updatedIds = await api.timeEntries.setAllocation(
        ids,
        allocationChoice,
        user?.email ?? null,
      )
      // Se refleja en la grilla sin recargar todo: el update ya se confirmó y
      // volver a traer 500+ filas por un cambio de columna es desproporcionado.
      // Se pintan sólo las filas que la base confirmó, no las pedidas.
      const applied = new Set((updatedIds ?? []).map(String))
      setEntries((prev) =>
        prev.map((e) => (applied.has(String(e.id)) ? { ...e, allocation: allocationChoice } : e)),
      )
      setSelectedIds(new Set())
      if (applied.size < ids.length) {
        // Nunca mostrar un éxito que no pasó: si la base actualizó menos filas
        // que las pedidas (factura emitida mientras tanto, o permiso denegado)
        // hay que decirlo y releer para mostrar el estado real.
        const skipped = ids.length - applied.size
        setApplyError(
          `${skipped} of ${ids.length} ${ids.length === 1 ? 'entry was' : 'entries were'} not reclassified — they may have been invoiced meanwhile. Reloading the latest data.`,
        )
        setReloadKey((k) => k + 1)
      }
    } catch (error) {
      console.error('No se pudo aplicar la allocation:', error)
      setApplyError('Could not apply the allocation — please try again.')
    } finally {
      setApplying(false)
    }
  }

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
          <button type="button" className="btn btn--ghost" onClick={() => setReloadKey((k) => k + 1)}>
            Retry
          </button>
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
                      {canAllocate && (
                        <th scope="col" style={{ width: 34 }}>
                          <input
                            type="checkbox"
                            checked={allPageSelected}
                            onChange={toggleAllOnPage}
                            disabled={selectableOnPage.length === 0}
                            aria-label="Select all selectable rows on this page"
                          />
                        </th>
                      )}
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
                      const frozen = isFrozen(entry)
                      return (
                        <tr key={entry.id}>
                          {canAllocate && (
                            <td>
                              <input
                                type="checkbox"
                                checked={selectedIds.has(entry.id)}
                                onChange={() => toggleRow(entry.id)}
                                disabled={frozen}
                                title={frozen ? 'Already invoiced — cannot be reclassified' : undefined}
                                aria-label={`Select entry ${entry.id}`}
                              />
                            </td>
                          )}
                          <td>{entry.user}</td>
                          <td className="cell-strong">{entry.project || '—'}</td>
                          <td className="cell-soft">{entry.client || '—'}</td>
                          <td className="cell-soft">{entry.task || '—'}</td>
                          <td className="cell-mono">{entry.date ? formatDate(entry.date) : '—'}</td>
                          <td className="cell-mono">{entry.date ? formatWeek(entry.date) : '—'}</td>
                          <td className="col-num cell-mono">{formatHours(entry.hours)}</td>
                          <td>
                            <StatusBadge status={entry.status} />
                          </td>
                          <td>
                            {allocation ? (
                              <span className={`badge ${allocation.cls}`}>{allocation.label}</span>
                            ) : (
                              <span className="badge badge--pending">— unallocated —</span>
                            )}
                          </td>
                          <td>
                            <BillingBadge status={billingStatus} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {canAllocate && selectedIds.size > 0 && (
                <div className="selbar">
                  <span className="selbar__count">
                    Selected: <b>{formatHours(selectedHours)} h</b> · {selectedIds.size}{' '}
                    {selectedIds.size === 1 ? 'entry' : 'entries'}
                  </span>
                  <div className="selbar__action">
                    <span className="selbar__label">Set allocation</span>
                    <select
                      className="field__input"
                      value={allocationChoice}
                      onChange={(e) => setAllocationChoice(e.target.value)}
                      aria-label="Allocation to apply"
                    >
                      {Object.entries(ALLOCATION_LABELS).map(([value, { label }]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                    <button type="button" className="btn btn--pay btn--sm" onClick={handleApply} disabled={applying}>
                      {applying ? 'Applying…' : 'Apply'}
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => {
                        setSelectedIds(new Set())
                        setApplyError('')
                      }}
                      disabled={applying}
                    >
                      Clear
                    </button>
                  </div>
                </div>
              )}
              {applyError && <p className="field__error">{applyError}</p>}

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
