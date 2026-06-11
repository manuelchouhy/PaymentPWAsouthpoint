import { useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, BellRing } from 'lucide-react'
import { getInvoices, getTimeEntries } from '../lib/data'
import {
  COLLECTION_STATUSES,
  collectionAlertLevel,
  collectionStatus,
  createCollection,
  getCollectionAlertSettings,
  getCollections,
} from '../lib/collectionsData'
import { formatDate } from '../lib/format'
import { CollectionBadge } from '../components/CollectionBadge'
import { MultiSelectDropdown } from '../components/MultiSelectDropdown'
import { RegisterCollectionModal } from '../components/RegisterCollectionModal'
import { Toast } from '../components/Toast'

function daysSince(iso) {
  if (!iso) return 0
  const [y, m, d] = iso.split('-').map(Number)
  const then = Date.UTC(y, m - 1, d)
  const now = new Date()
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((today - then) / 86400000)
}

function formatAmount(value) {
  return Number(value || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function CollectionsPage() {
  const { user } = useOutletContext()
  const [invoices, setInvoices] = useState([])
  const [collections, setCollections] = useState([])
  const [entries, setEntries] = useState([])
  const [alertSettings, setAlertSettings] = useState(null)
  const [status, setStatus] = useState('loading')
  const [filters, setFilters] = useState({
    contractors: [],
    clients: [],
    statuses: [],
    dateFrom: '',
    dateTo: '',
  })
  const [alertFilter, setAlertFilter] = useState(null) // null | 'overdue' | 'warning'
  const [modalRow, setModalRow] = useState(null)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    Promise.all([
      getInvoices(),
      getCollections(),
      getTimeEntries(),
      getCollectionAlertSettings(),
    ])
      .then(([inv, col, ent, settings]) => {
        if (cancelled) return
        setInvoices(inv)
        setCollections(col)
        setEntries(ent)
        setAlertSettings(settings)
        setStatus('ready')
      })
      .catch((error) => {
        if (cancelled) return
        console.error('No se pudo cargar Collections:', error)
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const collectedByInvoice = useMemo(() => {
    const map = new Map()
    for (const c of collections) {
      map.set(c.invoiceId, (map.get(c.invoiceId) ?? 0) + c.amountReceived)
    }
    return map
  }, [collections])

  const clientByEntryId = useMemo(() => {
    const map = new Map()
    for (const e of entries) map.set(String(e.id), e.client)
    return map
  }, [entries])

  const warningBefore = alertSettings?.warningDaysBeforeDue ?? 7

  // Una fila derivada por factura (con nivel de alerta desde settings).
  const rows = useMemo(
    () =>
      invoices.map((inv) => {
        const collected = collectedByInvoice.get(inv.id) ?? 0
        const outstanding = Math.max(0, inv.totalAmount - collected)
        const client =
          inv.entryIds.map((id) => clientByEntryId.get(String(id))).find(Boolean) ?? '—'
        const collStatus = collectionStatus(inv.totalAmount, collected)
        const daysPending = daysSince(inv.invoiceDate)
        const alertLevel =
          collStatus === 'Collected'
            ? 'on_time'
            : collectionAlertLevel(daysPending, inv.paymentTermsDays, warningBefore)
        return {
          inv,
          collected,
          outstanding,
          client,
          status: collStatus,
          daysPending,
          alertLevel,
        }
      }),
    [invoices, collectedByInvoice, clientByEntryId, warningBefore],
  )

  // KPIs sobre las facturas no cobradas (FR-12).
  const kpis = useMemo(() => {
    let overdue = 0
    let warning = 0
    let outstanding = 0
    for (const r of rows) {
      if (r.status === 'Collected') continue
      outstanding += r.outstanding
      if (r.alertLevel === 'overdue') overdue += 1
      else if (r.alertLevel === 'warning') warning += 1
    }
    return { overdue, warning, outstanding }
  }, [rows])

  const contractorOptions = useMemo(
    () => [...new Set(rows.map((r) => r.inv.userName))].sort(),
    [rows],
  )
  const clientOptions = useMemo(
    () => [...new Set(rows.map((r) => r.client).filter((c) => c && c !== '—'))].sort(),
    [rows],
  )

  const visible = useMemo(() => {
    const filtered = rows.filter((r) => {
      if (filters.contractors.length && !filters.contractors.includes(r.inv.userName))
        return false
      if (filters.clients.length && !filters.clients.includes(r.client)) return false
      if (filters.statuses.length) {
        if (!filters.statuses.includes(r.status)) return false
      } else if (r.status === 'Collected') {
        // Default: ocultar las ya cobradas.
        return false
      }
      if (filters.dateFrom && r.inv.invoiceDate < filters.dateFrom) return false
      if (filters.dateTo && r.inv.invoiceDate > filters.dateTo) return false
      if (alertFilter && r.alertLevel !== alertFilter) return false
      return true
    })
    return filtered.sort((a, b) => b.daysPending - a.daysPending)
  }, [rows, filters, alertFilter])

  const toggle = (key, value) =>
    setFilters((prev) => ({
      ...prev,
      [key]: prev[key].includes(value)
        ? prev[key].filter((v) => v !== value)
        : [...prev[key], value],
    }))

  async function handleRegister(payload) {
    const { inv, collected } = modalRow
    const { collection, becameCollected } = await createCollection(
      inv,
      payload,
      collected,
      user?.email ?? null,
    )
    setCollections((prev) => [collection, ...prev])
    if (becameCollected) {
      setInvoices((prev) =>
        prev.map((i) => (i.id === inv.id ? { ...i, status: 'Collected' } : i)),
      )
    }
    setModalRow(null)
    setToast({
      id: Date.now(),
      message: becameCollected
        ? `${inv.supplierInvoiceNumber} fully collected → Collected`
        : `Collection of $${formatAmount(payload.amountReceived)} registered for ${inv.supplierInvoiceNumber}`,
    })
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
          <span className="masthead__kicker">Collections · Client</span>
          <span className="masthead__rule" aria-hidden="true" />
        </div>
        <h1 className="masthead__title">Collections</h1>
        <p className="masthead__sub">
          Issued invoices and their collection status. Register full or partial
          collections; once completed, the invoice moves to Collected.
        </p>
      </motion.header>

      {status === 'loading' && <p className="state__hint">Loading invoices…</p>}
      {status === 'error' && (
        <div className="state state--error">
          <AlertTriangle size={28} strokeWidth={1.8} />
          <h2 className="state__title">Could not load Collections</h2>
        </div>
      )}

      {status === 'ready' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.05 }}
        >
          <div className="proj-kpis">
            <div className="proj-kpis__chips" role="group" aria-label="Collection alerts">
              <button
                type="button"
                className={`proj-kpi proj-kpi--overdue${alertFilter === 'overdue' ? ' is-active' : ''}`}
                onClick={() => setAlertFilter((c) => (c === 'overdue' ? null : 'overdue'))}
                aria-pressed={alertFilter === 'overdue'}
              >
                <span className="proj-kpi__count">{kpis.overdue}</span>
                <span className="proj-kpi__label">Overdue</span>
              </button>
              <button
                type="button"
                className={`proj-kpi proj-kpi--warning${alertFilter === 'warning' ? ' is-active' : ''}`}
                onClick={() => setAlertFilter((c) => (c === 'warning' ? null : 'warning'))}
                aria-pressed={alertFilter === 'warning'}
              >
                <span className="proj-kpi__count">{kpis.warning}</span>
                <span className="proj-kpi__label">Warning</span>
              </button>
              <div className="proj-kpi proj-kpi--total" aria-label="Total outstanding">
                <span className="proj-kpi__count">${formatAmount(kpis.outstanding)}</span>
                <span className="proj-kpi__label">Outstanding</span>
              </div>
            </div>
            <Link to="/collection-alerts" className="btn btn--ghost proj-alerts-link">
              <BellRing size={15} aria-hidden="true" />
              Alert settings
            </Link>
          </div>

          <section className="filterbar" aria-label="Filters">
            <div className="filterbar__head">
              <span className="filterbar__title">Filters</span>
            </div>
            <div className="filterbar__controls">
              <MultiSelectDropdown
                label="Contractor"
                options={contractorOptions}
                selected={filters.contractors}
                onToggle={(v) => toggle('contractors', v)}
              />
              <MultiSelectDropdown
                label="Client"
                options={clientOptions}
                selected={filters.clients}
                onToggle={(v) => toggle('clients', v)}
              />
              <MultiSelectDropdown
                label="Collection Status"
                options={COLLECTION_STATUSES}
                selected={filters.statuses}
                onToggle={(v) => toggle('statuses', v)}
              />
              <div className="filterfield">
                <span className="filterfield__label">Invoice from</span>
                <input type="date" className="filterfield__input" value={filters.dateFrom}
                  max={filters.dateTo || undefined}
                  onChange={(e) => setFilters((p) => ({ ...p, dateFrom: e.target.value }))} />
              </div>
              <div className="filterfield">
                <span className="filterfield__label">Invoice to</span>
                <input type="date" className="filterfield__input" value={filters.dateTo}
                  min={filters.dateFrom || undefined}
                  onChange={(e) => setFilters((p) => ({ ...p, dateTo: e.target.value }))} />
              </div>
            </div>
          </section>

          <div className="toolbar">
            <span className="toolbar__count">
              {visible.length} {visible.length === 1 ? 'invoice' : 'invoices'}
            </span>
          </div>

          {visible.length === 0 ? (
            <div className="empty">No invoices pending collection.</div>
          ) : (
            <div className="table-wrap table-wrap--scroll">
              <table className="table proj-table coll-table">
                <thead>
                  <tr>
                    <th scope="col">Invoice #</th>
                    <th scope="col">Contractor</th>
                    <th scope="col">Client</th>
                    <th scope="col" className="col-num">Amount</th>
                    <th scope="col">Invoice Date</th>
                    <th scope="col">Collection Status</th>
                    <th scope="col" className="col-num">Days Pending</th>
                    <th scope="col" className="col-num">Collected</th>
                    <th scope="col" className="col-num">Outstanding</th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r, index) => {
                    const overdueClass =
                      r.alertLevel === 'overdue'
                        ? 'row--overdue-high'
                        : r.alertLevel === 'warning'
                          ? 'row--overdue-mid'
                          : ''
                    return (
                      <motion.tr
                        key={r.inv.id}
                        className={overdueClass.trim()}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: Math.min(index * 0.02, 0.3) }}
                      >
                        <td className="cell-mono">{r.inv.supplierInvoiceNumber}</td>
                        <td>{r.inv.userName}</td>
                        <td className="cell-soft">{r.client}</td>
                        <td className="col-num cell-mono">${formatAmount(r.inv.totalAmount)}</td>
                        <td className="cell-mono">{formatDate(r.inv.invoiceDate)}</td>
                        <td><CollectionBadge status={r.status} /></td>
                        <td className="col-num cell-mono">{r.daysPending}</td>
                        <td className="col-num cell-mono">${formatAmount(r.collected)}</td>
                        <td className="col-num cell-mono cell-strong">${formatAmount(r.outstanding)}</td>
                        <td>
                          {r.status !== 'Collected' && (
                            <button
                              type="button"
                              className="btn btn--pay btn--row"
                              onClick={() => setModalRow(r)}
                            >
                              Register
                            </button>
                          )}
                        </td>
                      </motion.tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      )}

      <AnimatePresence>
        {modalRow && (
          <RegisterCollectionModal
            key={`col-${modalRow.inv.id}`}
            invoice={modalRow.inv}
            outstanding={modalRow.outstanding}
            collected={modalRow.collected}
            onClose={() => setModalRow(null)}
            onConfirm={handleRegister}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <Toast key={toast.id} message={toast.message} tone={toast.tone}
            onDismiss={() => setToast(null)} />
        )}
      </AnimatePresence>
    </>
  )
}
