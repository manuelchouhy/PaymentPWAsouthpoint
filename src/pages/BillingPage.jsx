import { useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'
import { api } from '../lib/api'
import { formatHours } from '../lib/format'
import { exportGrid } from '../lib/exportGrid'
import { useEntryFilters, applyEntryFilters } from '../lib/useEntryFilters'
import { MultiSelectDropdown } from '../components/MultiSelectDropdown'
import { ExportDropdown } from '../components/ExportDropdown'
import { BillModal } from '../components/BillModal'

const sortedUnique = (values) =>
  [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'))

// Una factura al cliente cubre horas de UN proveedor (misma regla que la
// pantalla de Time Entries): el número de factura y el monto son del proveedor.
const groupKey = (entry) => `${entry.user}||${entry.project ?? ''}||${entry.task ?? ''}`

export function BillingPage() {
  const { user, can } = useOutletContext()
  const [entries, setEntries] = useState([])
  const [invoices, setInvoices] = useState([])
  const [status, setStatus] = useState('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const [selectedKeys, setSelectedKeys] = useState(() => new Set())
  const [modalOpen, setModalOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const { filters, toggleValue, clear, isActive } = useEntryFilters()

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    Promise.all([api.timeEntries.list(), api.invoices.list()])
      .then(([entryRows, invoiceRows]) => {
        if (cancelled) return
        setEntries(entryRows)
        setInvoices(invoiceRows)
        setSelectedKeys(new Set())
        setStatus('ready')
      })
      .catch((error) => {
        if (cancelled) return
        console.error('No se pudo cargar Billing:', error)
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const invoiceByEntryId = useMemo(() => {
    const map = new Map()
    for (const invoice of invoices) {
      for (const entryId of invoice.entryIds ?? []) map.set(String(entryId), invoice)
    }
    return map
  }, [invoices])

  // Toda la pantalla mira sólo horas facturables al cliente: overage y SP
  // internal no se le cobran a nadie acá (el overage se resuelve por Change
  // Request, en Projects and SOW).
  const billable = useMemo(
    () => entries.filter((e) => e.allocation === 'bill_to_client'),
    [entries],
  )

  const options = useMemo(
    () => ({
      contractors: sortedUnique(billable.map((e) => e.user)),
      clients: sortedUnique(billable.map((e) => e.client)),
      projects: sortedUnique(billable.map((e) => e.project)),
    }),
    [billable],
  )

  const filtered = useMemo(
    () => applyEntryFilters(billable, filters, invoiceByEntryId),
    [billable, filters, invoiceByEntryId],
  )

  useEffect(() => {
    setSelectedKeys(new Set())
  }, [filters])

  const cards = useMemo(() => {
    let pendingToBill = 0
    let pendingCount = 0
    let invoiced = 0
    let collected = 0
    for (const entry of filtered) {
      const hours = Number(entry.hours) || 0
      const invoice = invoiceByEntryId.get(String(entry.id))
      if (!invoice) {
        // Sólo las aprobadas están listas para facturar: una hora rechazada no
        // se le cobra al cliente.
        if (entry.status === 'Approved') {
          pendingToBill += hours
          pendingCount += 1
        }
        continue
      }
      invoiced += hours
      // Collected y Paid ya se cobraron: Paid es el paso siguiente (se le pagó
      // al proveedor), no una vuelta atrás.
      if (invoice.status === 'Collected' || invoice.status === 'Paid') collected += hours
    }
    return { pendingToBill, pendingCount, invoiced, collected, pendingCollection: invoiced - collected }
  }, [filtered, invoiceByEntryId])

  // La grilla agrupa por proveedor · proyecto · task, como el prototipo: nadie
  // factura hora por hora, se factura "el backend de tal SOW".
  const groups = useMemo(() => {
    const byKey = new Map()
    for (const entry of filtered) {
      if (entry.status !== 'Approved') continue
      if (invoiceByEntryId.has(String(entry.id))) continue
      const key = groupKey(entry)
      const group = byKey.get(key)
      if (group) {
        group.hours += Number(entry.hours) || 0
        group.entries.push(entry)
      } else {
        byKey.set(key, {
          key,
          user: entry.user,
          project: entry.project ?? '',
          task: entry.task ?? '',
          client: entry.client ?? '',
          hours: Number(entry.hours) || 0,
          entries: [entry],
        })
      }
    }
    return [...byKey.values()].sort(
      (a, b) => a.user.localeCompare(b.user, 'es') || b.hours - a.hours,
    )
  }, [filtered, invoiceByEntryId])

  const selectedGroups = groups.filter((g) => selectedKeys.has(g.key))
  const selectedEntries = selectedGroups.flatMap((g) => g.entries)
  const selectedHours = selectedGroups.reduce((sum, g) => sum + g.hours, 0)
  const selectedProviders = sortedUnique(selectedGroups.map((g) => g.user))
  const allSelected = groups.length > 0 && groups.every((g) => selectedKeys.has(g.key))
  const canCreate = can('billing.create')
  const canBill = canCreate && selectedEntries.length > 0 && selectedProviders.length === 1

  function toggleGroup(key) {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleAll() {
    setSelectedKeys(allSelected ? new Set() : new Set(groups.map((g) => g.key)))
  }

  function handleExport(format) {
    const cols = [
      { header: 'Provider', key: 'provider' },
      { header: 'Client', key: 'client' },
      { header: 'Project', key: 'project' },
      { header: 'Task', key: 'task' },
      { header: 'Hours', key: 'hours' },
      { header: 'Entries', key: 'entries' },
    ]
    const rows = groups.map((g) => ({
      provider: g.user,
      client: g.client,
      project: g.project,
      task: g.task,
      hours: g.hours,
      entries: g.entries.length,
    }))
    exportGrid({
      rows,
      columns: cols,
      title: 'Billing · ready to bill',
      gridName: 'billing-ready-to-bill',
      format,
      generatedBy: user?.email ?? '',
    })
  }

  async function handleConfirmBill({
    supplierInvoiceNumber,
    invoiceDate,
    currency,
    totalAmount,
    notes,
  }) {
    const entryIds = selectedEntries.map((e) => e.id)
    const provider = selectedProviders[0]
    const { invoice } = await api.invoices.create({
      supplierInvoiceNumber,
      invoiceDate,
      currency,
      totalAmount,
      notes,
      userName: provider,
      entryIds,
      createdBy: user?.email ?? null,
    })
    api.audit.log({
      actorEmail: user?.email,
      action: 'invoice.create',
      resourceType: 'invoice',
      resourceId: invoice.id,
      after: {
        supplierInvoiceNumber,
        invoiceDate,
        totalAmount,
        userName: provider,
        entryCount: entryIds.length,
        source: 'billing',
      },
    })
    setModalOpen(false)
    setNotice(
      `Invoice ${supplierInvoiceNumber} issued for ${provider} — ${formatHours(selectedHours)} h.`,
    )
    // Se relee en vez de parchear: la factura nueva cambia las 4 tarjetas y saca
    // las filas de la grilla, y esos números no se pueden inventar localmente.
    setReloadKey((k) => k + 1)
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
          <span className="masthead__kicker">Billing</span>
          <span className="masthead__rule" aria-hidden="true" />
        </div>
        <h1 className="masthead__title">Billing</h1>
        <p className="masthead__sub">
          Hours classified as bill to client, ready to enter the existing invoice pipeline.
        </p>
      </motion.header>

      {notice && <p className="state__hint">{notice}</p>}

      {status === 'loading' && <p className="state__hint">Loading billing data…</p>}

      {status === 'error' && (
        <div className="state state--error">
          <AlertTriangle size={28} strokeWidth={1.8} />
          <h2 className="state__title">Could not load billing data</h2>
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
              {isActive && (
                <button type="button" className="btn btn--ghost filterbar__clear" onClick={clear}>
                  Clear
                </button>
              )}
            </div>
          </section>

          <div className="dash-kpis">
            <div className="dash-kpi dash-kpi--static">
              <div className="dash-kpi__head">
                <span className="dash-kpi__label">Pending to bill</span>
              </div>
              <span className="dash-kpi__value">
                {formatHours(cards.pendingToBill)}
                <span className="dash-kpi__unit"> h</span>
              </span>
              <span className="dash-kpi__hint">
                {cards.pendingCount} approved {cards.pendingCount === 1 ? 'entry' : 'entries'}
              </span>
            </div>
            <div className="dash-kpi dash-kpi--static">
              <div className="dash-kpi__head">
                <span className="dash-kpi__label">Invoiced</span>
              </div>
              <span className="dash-kpi__value">
                {formatHours(cards.invoiced)}
                <span className="dash-kpi__unit"> h</span>
              </span>
            </div>
            <div className="dash-kpi dash-kpi--static">
              <div className="dash-kpi__head">
                <span className="dash-kpi__label">Collected</span>
              </div>
              <span className="dash-kpi__value">
                {formatHours(cards.collected)}
                <span className="dash-kpi__unit"> h</span>
              </span>
            </div>
            <div className="dash-kpi dash-kpi--static">
              <div className="dash-kpi__head">
                <span className="dash-kpi__label">Pending collection</span>
              </div>
              <span className="dash-kpi__value">
                {formatHours(cards.pendingCollection)}
                <span className="dash-kpi__unit"> h</span>
              </span>
            </div>
          </div>

          <div className="toolbar">
            <span className="toolbar__count">
              Ready to bill · {groups.length} {groups.length === 1 ? 'group' : 'groups'}
            </span>
            {groups.length > 0 && <ExportDropdown onExport={handleExport} />}
          </div>

          {groups.length === 0 ? (
            <div className="empty">
              No hours ready to bill. Classify approved hours as “bill to client” in Entries first.
            </div>
          ) : (
            <>
              <div className="table-wrap table-wrap--scroll">
                <table className="table proj-table">
                  <thead>
                    <tr>
                      {canCreate && (
                        <th scope="col" style={{ width: 34 }}>
                          <input
                            type="checkbox"
                            checked={allSelected}
                            onChange={toggleAll}
                            aria-label="Select all groups"
                          />
                        </th>
                      )}
                      <th scope="col">Provider</th>
                      <th scope="col">Project · task</th>
                      <th scope="col">Client</th>
                      <th scope="col" className="col-num">Hours</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((group) => (
                      <tr key={group.key}>
                        {canCreate && (
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedKeys.has(group.key)}
                              onChange={() => toggleGroup(group.key)}
                              aria-label={`Select ${group.user} · ${group.project}`}
                            />
                          </td>
                        )}
                        <td className="cell-strong">{group.user}</td>
                        <td>
                          {group.project || '—'}
                          {group.task && <div className="cell-soft">{group.task}</div>}
                        </td>
                        <td className="cell-soft">{group.client || '—'}</td>
                        <td className="col-num cell-mono">{formatHours(group.hours)}</td>
                        <td>
                          <span className="badge badge--pending">to bill</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {canCreate && selectedKeys.size > 0 && (
                <div className="selbar">
                  <span className="selbar__count">
                    Selected to bill: <b>{formatHours(selectedHours)} h</b> ·{' '}
                    {selectedEntries.length} {selectedEntries.length === 1 ? 'entry' : 'entries'}
                  </span>
                  <div className="selbar__action">
                    <button
                      type="button"
                      className="btn btn--pay btn--sm"
                      onClick={() => setModalOpen(true)}
                      disabled={!canBill}
                      title={
                        selectedProviders.length > 1
                          ? 'One invoice covers a single provider — narrow the selection'
                          : undefined
                      }
                    >
                      Send to billing
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setSelectedKeys(new Set())}
                    >
                      Clear
                    </button>
                  </div>
                </div>
              )}

              {selectedProviders.length > 1 && (
                <p className="field__error">
                  An invoice covers one provider only. Selected: {selectedProviders.join(', ')}.
                </p>
              )}
            </>
          )}
        </motion.div>
      )}

      {modalOpen && canBill && (
        <BillModal
          user={selectedProviders[0]}
          entries={selectedEntries}
          hours={selectedHours}
          onClose={() => setModalOpen(false)}
          onConfirm={handleConfirmBill}
        />
      )}
    </>
  )
}
