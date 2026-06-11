import { useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, BellRing, FileText, Plus, Star } from 'lucide-react'
import {
  RENEWAL_TYPES,
  SUPPLIER_STATUSES,
  createSupplierContract,
  displaySupplierStatus,
  getSupplierAlertSettings,
  getSupplierContracts,
  markRenewalInProgress,
  priorityAlertContracts,
  renewSupplierContract,
  supplierRowTint,
  updateSupplierContract,
  uploadContractPdf,
} from '../lib/supplierContractsData'
import { daysRemaining } from '../lib/projectsData'
import { formatDate } from '../lib/format'
import { SupplierStatusBadge } from '../components/SupplierStatusBadge'
import { MultiSelectDropdown } from '../components/MultiSelectDropdown'
import { SupplierContractFormModal } from '../components/SupplierContractFormModal'
import { RenewContractModal } from '../components/RenewContractModal'
import { SupplierContractDrawer } from '../components/SupplierContractDrawer'
import { PriorityContractBanner } from '../components/PriorityContractBanner'
import { Toast } from '../components/Toast'

const SNOOZE_DAYS = 7

const sortByExp = (list) =>
  [...list].sort((a, b) => a.expirationDate.localeCompare(b.expirationDate))

export function SupplierContractsPage() {
  const { user } = useOutletContext()
  const [contracts, setContracts] = useState([])
  const [status, setStatus] = useState('loading')
  const [filters, setFilters] = useState({
    supplier: '',
    statuses: [],
    renewalTypes: [],
    expFrom: '',
    expTo: '',
  })
  const [form, setForm] = useState(null) // null | {mode:'new'} | {mode:'edit', contract}
  const [renewing, setRenewing] = useState(null) // null | contract
  const [detail, setDetail] = useState(null)
  const [alertSettings, setAlertSettings] = useState(null)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    Promise.all([getSupplierContracts(), getSupplierAlertSettings()])
      .then(([data, settings]) => {
        if (cancelled) return
        setContracts(data)
        setAlertSettings(settings)
        setStatus('ready')
      })
      .catch((error) => {
        if (cancelled) return
        console.error('No se pudieron cargar los contratos:', error)
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const widestThreshold = alertSettings?.threshold1Days ?? 90
  const priorityAlerts = useMemo(
    () => priorityAlertContracts(contracts, widestThreshold),
    [contracts, widestThreshold],
  )

  const rows = useMemo(() => {
    const filtered = contracts.filter((c) => {
      if (
        filters.supplier &&
        !c.supplierName.toLowerCase().includes(filters.supplier.toLowerCase())
      )
        return false
      if (filters.statuses.length && !filters.statuses.includes(displaySupplierStatus(c)))
        return false
      if (filters.renewalTypes.length && !filters.renewalTypes.includes(c.renewalType))
        return false
      if (filters.expFrom && c.expirationDate < filters.expFrom) return false
      if (filters.expTo && c.expirationDate > filters.expTo) return false
      return true
    })
    return sortByExp(filtered)
  }, [contracts, filters])

  const toggle = (key, value) =>
    setFilters((prev) => ({
      ...prev,
      [key]: prev[key].includes(value)
        ? prev[key].filter((v) => v !== value)
        : [...prev[key], value],
    }))

  async function handleCreate(payload, pdfFile) {
    if (pdfFile) payload = { ...payload, pdfUrl: await uploadContractPdf(pdfFile) }
    const created = await createSupplierContract(payload, user?.email ?? null)
    setContracts((prev) => sortByExp([created, ...prev]))
    setForm(null)
    setToast({ id: Date.now(), message: `Contract created — ${created.contractNumber}` })
  }

  async function handleUpdate(payload, pdfFile) {
    if (pdfFile) payload = { ...payload, pdfUrl: await uploadContractPdf(pdfFile) }
    const updated = await updateSupplierContract(form.contract, payload, user?.email ?? null)
    setContracts((prev) => sortByExp(prev.map((c) => (c.id === updated.id ? updated : c))))
    setForm(null)
    setToast({ id: Date.now(), message: `Contract updated — ${updated.contractNumber}` })
  }

  async function handleRenew(payload, pdfFile) {
    const pdfUrl = await uploadContractPdf(pdfFile)
    const { archived, created } = await renewSupplierContract(
      renewing,
      { ...payload, pdfUrl },
      user?.email ?? null,
    )
    setContracts((prev) =>
      sortByExp([created, ...prev.map((c) => (c.id === archived.id ? archived : c))].filter((c) => !c.archived)),
    )
    setRenewing(null)
    setToast({ id: Date.now(), message: `Contract renewed — ${created.contractNumber}` })
  }

  async function handleMarkRenewal(contract) {
    const updated = await markRenewalInProgress(contract, SNOOZE_DAYS, user?.email ?? null)
    setContracts((prev) => sortByExp(prev.map((c) => (c.id === updated.id ? updated : c))))
    setDetail(null)
    setToast({
      id: Date.now(),
      message: `Renewal in progress — snoozed for ${SNOOZE_DAYS} days`,
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
          <span className="masthead__kicker">Contracts · Supplier</span>
          <span className="masthead__rule" aria-hidden="true" />
        </div>
        <h1 className="masthead__title">Supplier Contracts</h1>
        <p className="masthead__sub">
          Supplier (contractor) contracts, sorted by expiration date.
          southpointlabs receives priority treatment.
        </p>
      </motion.header>

      <AnimatePresence>
        {priorityAlerts.length > 0 && (
          <PriorityContractBanner
            contracts={priorityAlerts}
            onRenew={(c) => setRenewing(c)}
            onMarkRenewal={(c) => handleMarkRenewal(c)}
          />
        )}
      </AnimatePresence>

      {status === 'loading' && <p className="state__hint">Loading contracts…</p>}
      {status === 'error' && (
        <div className="state state--error">
          <AlertTriangle size={28} strokeWidth={1.8} />
          <h2 className="state__title">Could not load contracts</h2>
        </div>
      )}

      {status === 'ready' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.05 }}
        >
          <section className="filterbar" aria-label="Filters">
            <div className="filterbar__head">
              <span className="filterbar__title">Filters</span>
              <div className="filterbar__head-actions">
                <Link to="/supplier-alerts" className="btn btn--ghost proj-alerts-link">
                  <BellRing size={15} aria-hidden="true" />
                  Alert settings
                </Link>
                <button type="button" className="btn btn--pay proj-new-btn" onClick={() => setForm({ mode: 'new' })}>
                  <Plus size={16} strokeWidth={2.4} aria-hidden="true" />
                  New Contract
                </button>
              </div>
            </div>
            <div className="filterbar__controls">
              <div className="filterfield">
                <span className="filterfield__label">Supplier</span>
                <input type="text" className="filterfield__input" placeholder="Search…"
                  value={filters.supplier}
                  onChange={(e) => setFilters((p) => ({ ...p, supplier: e.target.value }))} />
              </div>
              <MultiSelectDropdown label="Status" options={SUPPLIER_STATUSES}
                selected={filters.statuses} onToggle={(v) => toggle('statuses', v)} />
              <MultiSelectDropdown label="Renewal Type" options={RENEWAL_TYPES}
                selected={filters.renewalTypes} onToggle={(v) => toggle('renewalTypes', v)} />
              <div className="filterfield">
                <span className="filterfield__label">Due from</span>
                <input type="date" className="filterfield__input" value={filters.expFrom}
                  max={filters.expTo || undefined}
                  onChange={(e) => setFilters((p) => ({ ...p, expFrom: e.target.value }))} />
              </div>
              <div className="filterfield">
                <span className="filterfield__label">Due to</span>
                <input type="date" className="filterfield__input" value={filters.expTo}
                  min={filters.expFrom || undefined}
                  onChange={(e) => setFilters((p) => ({ ...p, expTo: e.target.value }))} />
              </div>
            </div>
          </section>

          <div className="toolbar">
            <span className="toolbar__count">
              {rows.length} {rows.length === 1 ? 'contract' : 'contracts'}
            </span>
          </div>

          {rows.length === 0 ? (
            <div className="empty">No contracts to display.</div>
          ) : (
            <div className="table-wrap table-wrap--scroll">
              <table className="table proj-table">
                <thead>
                  <tr>
                    <th scope="col">Supplier</th>
                    <th scope="col">Contract #</th>
                    <th scope="col">Start Date</th>
                    <th scope="col">Expiration Date</th>
                    <th scope="col">Renewal Date</th>
                    <th scope="col">Payment Terms</th>
                    <th scope="col">Renewal Type</th>
                    <th scope="col">Status</th>
                    <th scope="col">PDF</th>
                    <th scope="col" className="col-num">Days Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c, index) => {
                    const days = daysRemaining(c.expirationDate)
                    const st = displaySupplierStatus(c)
                    const tint = st === 'Renewal in Progress' ? '' : supplierRowTint(days)
                    const cls = [
                      tint ? `sc-row--${tint}` : '',
                      c.isPrioritySupplier ? 'sc-row--priority' : '',
                    ].filter(Boolean).join(' ')
                    return (
                      <motion.tr
                        key={c.id}
                        className={cls}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: Math.min(index * 0.02, 0.3) }}
                        onClick={() => setDetail(c)}
                        title={`View ${c.supplierName}`}
                      >
                        <td className="cell-strong">
                          {c.isPrioritySupplier && (
                            <Star size={13} aria-hidden="true" className="sc-priority-star" />
                          )}
                          {c.supplierName}
                        </td>
                        <td className="cell-mono">{c.contractNumber}</td>
                        <td className="cell-mono">{formatDate(c.startDate)}</td>
                        <td className="cell-mono">{formatDate(c.expirationDate)}</td>
                        <td className="cell-mono">{formatDate(c.renewalDate)}</td>
                        <td className="cell-mono">{c.paymentTerms}</td>
                        <td className="cell-soft">{c.renewalType}</td>
                        <td><SupplierStatusBadge status={st} /></td>
                        <td>
                          {c.pdfUrl ? (
                            <span className="sc-pdf-badge" title="Download from detail view">
                              <FileText size={14} aria-hidden="true" /> PDF
                            </span>
                          ) : '—'}
                        </td>
                        <td className={`col-num cell-mono${days != null && days < 0 ? ' proj-days--overdue' : ''}`}>
                          {days == null ? '—' : days}
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
        {form && (
          <SupplierContractFormModal
            key={form.mode === 'edit' ? `edit-${form.contract.id}` : 'new'}
            initial={form.mode === 'edit' ? form.contract : null}
            onClose={() => setForm(null)}
            onSubmit={form.mode === 'edit' ? handleUpdate : handleCreate}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {renewing && (
          <RenewContractModal
            key={`renew-${renewing.id}`}
            contract={renewing}
            onClose={() => setRenewing(null)}
            onSubmit={handleRenew}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {detail && (
          <SupplierContractDrawer
            key={`detail-${detail.id}`}
            contract={detail}
            onClose={() => setDetail(null)}
            onEdit={() => {
              const contract = detail
              setDetail(null)
              setForm({ mode: 'edit', contract })
            }}
            onRenew={() => {
              const contract = detail
              setDetail(null)
              setRenewing(contract)
            }}
            onMarkRenewal={() => handleMarkRenewal(detail)}
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
