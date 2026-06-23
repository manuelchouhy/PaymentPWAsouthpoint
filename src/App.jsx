import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import confetti from 'canvas-confetti'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { ExportDropdown } from './components/ExportDropdown'
import { exportGrid } from './lib/exportGrid'
import {
  createInvoice,
  getInvoices,
  getSyncStatus,
  getTimeEntries,
  triggerSync,
  updateInvoiceStatus,
} from './lib/data'
import { useMediaQuery } from './lib/useMediaQuery'
import { formatHours } from './lib/format'
import { useEntryFilters, applyEntryFilters } from './lib/useEntryFilters'
import { FilterBar } from './components/FilterBar'
import { ViewTabs } from './components/ViewTabs'
import { SelectionBar } from './components/SelectionBar'
import { Stepper } from './components/Stepper'
import { EntriesTable } from './components/EntriesTable'
import { EntriesCards } from './components/EntriesCards'
import { BillModal } from './components/BillModal'
import { InvoiceDetailDrawer } from './components/InvoiceDetailDrawer'
import { SyncStatus } from './components/SyncStatus'
import { SyncLogModal } from './components/SyncLogModal'
import { Toast } from './components/Toast'
import { logAudit } from './lib/auditData'

const VIOLET_CONFETTI = ['#A78BFA', '#C4B5FD', '#8B5CF6', '#DDD6FE', '#7C3AED']

function fireConfetti() {
  if (typeof window === 'undefined') return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

  const burst = (originX) =>
    confetti({
      particleCount: 60,
      spread: 70,
      startVelocity: 42,
      gravity: 0.9,
      ticks: 180,
      origin: { x: originX, y: 0.85 },
      colors: VIOLET_CONFETTI,
      shapes: ['circle', 'square'],
      scalar: 0.9,
      disableForReducedMotion: true,
    })

  burst(0.25)
  burst(0.75)
  setTimeout(
    () =>
      confetti({
        particleCount: 50,
        spread: 100,
        startVelocity: 28,
        gravity: 1,
        origin: { x: 0.5, y: 0.75 },
        colors: VIOLET_CONFETTI,
        scalar: 0.8,
        disableForReducedMotion: true,
      }),
    180,
  )
}

export default function App() {
  const { user, profile, can } = useOutletContext()
  const [entries, setEntries] = useState([])
  const [invoices, setInvoices] = useState([])
  const [status, setStatus] = useState('loading') // 'loading' | 'ready' | 'error'
  const [reloadKey, setReloadKey] = useState(0)

  // FR-03 · estado de filtros centralizado en un hook.
  const { filters, toggleValue, setField, clear, isActive } = useEntryFilters()
  // FR-04 · vista activa. Default "Pendientes de facturar"; al refrescar la
  // página vuelve a la default (es estado de sesión, no se persiste en URL).
  const [activeTab, setActiveTab] = useState('pending') // 'pending' | 'all'
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  // Entradas recién facturadas: se resaltan en verde unos segundos tras emitir
  // la factura, para que el cambio (Pending → Invoiced) sea visible.
  const [justInvoicedIds, setJustInvoicedIds] = useState(() => new Set())
  const [modalOpen, setModalOpen] = useState(false)
  const [openInvoiceId, setOpenInvoiceId] = useState(null) // FR-06 · detalle
  const [toast, setToast] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState(null)
  const [syncLogOpen, setSyncLogOpen] = useState(false)

  const isMobile = useMediaQuery('(max-width: 720px)')

  // --- Carga de datos (entries + invoices en paralelo) ----------------------
  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    Promise.all([getTimeEntries(), getInvoices()])
      .then(([entriesData, invoicesData]) => {
        if (cancelled) return
        setEntries(entriesData)
        setInvoices(invoicesData)
        setStatus('ready')
      })
      .catch((error) => {
        if (cancelled) return
        console.error('No se pudieron cargar las entradas:', error)
        setStatus('error')
      })
    // El estado del último sync se carga aparte: si falla, no rompe la grilla.
    getSyncStatus()
      .then((data) => {
        if (!cancelled) setSyncStatus(data)
      })
      .catch((error) => {
        console.warn('No se pudo cargar el estado de sync:', error)
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  // --- Mapa entryId -> factura asociada (recalculado al cambiar invoices) ---
  // Las claves se normalizan a String: `time_entries.id` y `invoices.entry_ids`
  // pueden llegar de Supabase con tipos distintos (number vs string, p. ej. los
  // bigint grandes), y Map compara estricto. Normalizar evita falsos "Pending".
  const invoiceByEntryId = useMemo(() => {
    const map = new Map()
    for (const invoice of invoices) {
      for (const entryId of invoice.entryIds) {
        map.set(String(entryId), {
          invoiceId: invoice.id,
          supplierInvoiceNumber: invoice.supplierInvoiceNumber,
          status: invoice.status,
        })
      }
    }
    return map
  }, [invoices])

  const getInvoice = useCallback(
    (entryId) => invoiceByEntryId.get(String(entryId)) ?? null,
    [invoiceByEntryId],
  )

  // FR-06 · factura abierta en el drawer de detalle + sus time entries.
  const openInvoice = useMemo(
    () => invoices.find((inv) => inv.id === openInvoiceId) ?? null,
    [invoices, openInvoiceId],
  )
  const openInvoiceEntries = useMemo(() => {
    if (!openInvoice) return []
    const ids = new Set(openInvoice.entryIds.map(String))
    return entries.filter((entry) => ids.has(String(entry.id)))
  }, [openInvoice, entries])

  // --- Derivados ------------------------------------------------------------
  // Opciones para los multi-selects de filtros (orden alfabético es-AR).
  const sortedUnique = (values) =>
    [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'))

  const users = useMemo(
    () => sortedUnique(entries.map((entry) => entry.user)),
    [entries],
  )
  const clients = useMemo(
    () => sortedUnique(entries.map((entry) => entry.client)),
    [entries],
  )
  const projects = useMemo(
    () => sortedUnique(entries.map((entry) => entry.project)),
    [entries],
  )

  const isInvoiced = useCallback(
    (entry) => invoiceByEntryId.has(String(entry.id)),
    [invoiceByEntryId],
  )

  // Billing Status de 4 estados: "Pending" si no está en ninguna factura; si no,
  // el status de la factura asociada (Invoiced | Collected | Paid).
  const getBillingStatus = useCallback(
    (entry) => invoiceByEntryId.get(String(entry.id))?.status ?? 'Pending',
    [invoiceByEntryId],
  )

  // FR-03 · entradas tras aplicar todos los filtros (sin la tab todavía).
  const filteredEntries = useMemo(
    () => applyEntryFilters(entries, filters, getBillingStatus),
    [entries, filters, getBillingStatus],
  )

  // FR-04 · "Pendiente de facturar" = todavía no está en ninguna factura. Los
  // contadores se recalculan solos cuando cambian filtros o facturas.
  const pendingCount = useMemo(
    () => filteredEntries.filter((entry) => !isInvoiced(entry)).length,
    [filteredEntries, isInvoiced],
  )
  const allCount = filteredEntries.length

  // Vista final: la tab se aplica ENCIMA de los filtros.
  const visibleEntries = useMemo(
    () =>
      activeTab === 'pending'
        ? filteredEntries.filter((entry) => !isInvoiced(entry))
        : filteredEntries,
    [filteredEntries, activeTab, isInvoiced],
  )

  // FR-03 · contadores de los 4 estados sobre el resultado actualmente visible.
  const statusCounts = useMemo(() => {
    const counts = { Pending: 0, Invoiced: 0, Collected: 0, Paid: 0 }
    for (const entry of visibleEntries) {
      counts[getBillingStatus(entry)] += 1
    }
    return counts
  }, [visibleEntries, getBillingStatus])

  const selectedEntries = useMemo(
    () => entries.filter((entry) => selectedIds.has(entry.id)),
    [entries, selectedIds],
  )

  const selectedHours = useMemo(
    () => selectedEntries.reduce((sum, entry) => sum + entry.hours, 0),
    [selectedEntries],
  )

  const selectedUsers = useMemo(
    () => [...new Set(selectedEntries.map((entry) => entry.user))],
    [selectedEntries],
  )

  // --- Métricas del stepper de 4 estados (sobre TODAS las entries) ----------
  const stepperMetrics = useMemo(() => {
    let approvedHours = 0
    let invoicedHours = 0
    let collectedHours = 0
    let paidHours = 0
    for (const entry of entries) {
      if (entry.status !== 'Approved') continue
      approvedHours += entry.hours
      const billing = invoiceByEntryId.get(String(entry.id))?.status
      if (billing === 'Invoiced') invoicedHours += entry.hours
      else if (billing === 'Collected') collectedHours += entry.hours
      else if (billing === 'Paid') paidHours += entry.hours
    }
    return { approvedHours, invoicedHours, collectedHours, paidHours }
  }, [entries, invoiceByEntryId])

  // Regla clave: sólo se puede facturar si hay selección, de un único proveedor, y con permiso.
  const canBill = can('billing.create') && selectedEntries.length > 0 && selectedUsers.length === 1

  // "Seleccionable" = no está facturada ya
  const isSelectable = useCallback(
    (entry) => !invoiceByEntryId.has(String(entry.id)),
    [invoiceByEntryId],
  )

  const visibleSelectable = useMemo(
    () => visibleEntries.filter(isSelectable),
    [visibleEntries, isSelectable],
  )

  const allVisibleSelected =
    visibleSelectable.length > 0 &&
    visibleSelectable.every((entry) => selectedIds.has(entry.id))
  const someVisibleSelected = visibleSelectable.some((entry) =>
    selectedIds.has(entry.id),
  )

  // --- Acciones -------------------------------------------------------------
  function toggleEntry(id) {
    // Defensa extra: nunca togglear una entrada ya facturada.
    if (invoiceByEntryId.has(id)) return
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllVisible() {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (visibleSelectable.every((entry) => next.has(entry.id))) {
        visibleSelectable.forEach((entry) => next.delete(entry.id))
      } else {
        visibleSelectable.forEach((entry) => next.add(entry.id))
      }
      return next
    })
  }

  async function handleRefresh() {
    if (syncing) return
    setSyncing(true)
    try {
      const result = await triggerSync()
      const [entriesData, invoicesData, syncData] = await Promise.all([
        getTimeEntries(),
        getInvoices(),
        getSyncStatus(),
      ])
      setEntries(entriesData)
      setInvoices(invoicesData)
      setSyncStatus(syncData)
      // Mantener la selección de filas que sigan existiendo tras el refresh.
      setSelectedIds((prev) => {
        const stillExisting = new Set(entriesData.map((entry) => entry.id))
        const next = new Set()
        for (const id of prev) {
          if (stillExisting.has(id)) next.add(id)
        }
        return next
      })
      const syncedMsg =
        typeof result.synced === 'number'
          ? `Synced · ${result.synced} ${
              result.synced === 1 ? 'record' : 'records'
            }`
          : 'Synced'
      setToast({ id: Date.now(), tone: 'success', message: syncedMsg })
    } catch (error) {
      console.error('No se pudo sincronizar:', error)
      setToast({
        id: Date.now(),
        tone: 'error',
        message: 'Could not refresh, please try again',
      })
      // La Edge Function registró el estado 'Error': reflejarlo en la barra.
      getSyncStatus()
        .then((data) => setSyncStatus(data))
        .catch(() => {})
    } finally {
      setSyncing(false)
    }
  }

  async function handleConfirmBill({
    supplierInvoiceNumber,
    invoiceDate,
    totalAmount,
    notes,
  }) {
    const billedCount = selectedEntries.length
    const billedUser = selectedUsers[0]
    const billedHoursFmt = formatHours(selectedHours)
    const billedIds = selectedEntries.map((entry) => entry.id)

    const { invoice } = await createInvoice({
      supplierInvoiceNumber,
      invoiceDate,
      totalAmount,
      notes,
      userName: billedUser,
      entryIds: billedIds,
      createdBy: user?.email ?? null,
    })

    logAudit({
      actorEmail: user?.email,
      actorRole: profile?.roles?.[0] ?? null,
      action: 'invoice.create',
      resourceType: 'invoice',
      resourceId: invoice.id,
      after: { supplierInvoiceNumber, invoiceDate, totalAmount, userName: billedUser, entryCount: billedIds.length },
    })
    // Sumar la factura al estado local → las filas facturadas se marcan en vivo.
    setInvoices((prev) => [invoice, ...prev])
    setModalOpen(false)
    setSelectedIds(new Set())
    // Mostrar el resultado: en "Pending" las filas facturadas desaparecen, así que
    // saltamos a "All" y las resaltamos en verde con su nº de factura unos segundos.
    setActiveTab('all')
    setJustInvoicedIds(new Set(billedIds))
    window.setTimeout(() => setJustInvoicedIds(new Set()), 4500)
    setToast({
      id: Date.now(),
      message: `Invoice issued — ${billedCount} ${
        billedCount === 1 ? 'entry' : 'entries'
      } from ${billedUser} · ${billedHoursFmt} h · ${supplierInvoiceNumber}`,
    })
    fireConfetti()
  }

  // FR-06 · avanzar el estado de una factura desde el drawer (transición validada).
  async function handleChangeInvoiceStatus(toStatus) {
    if (!openInvoice) return null
    const { historyEntry } = await updateInvoiceStatus({
      invoiceId: openInvoice.id,
      fromStatus: openInvoice.status,
      toStatus,
      changedBy: user?.email ?? null,
      note: null,
    })
    logAudit({
      actorEmail: user?.email,
      actorRole: profile?.roles?.[0] ?? null,
      action: 'invoice.status_change',
      resourceType: 'invoice',
      resourceId: openInvoice.id,
      before: { status: openInvoice.status },
      after: { status: toStatus },
    })
    // Reflejar el nuevo estado en el estado local → badges/stepper/drawer en vivo.
    setInvoices((prev) =>
      prev.map((inv) =>
        inv.id === openInvoice.id ? { ...inv, status: toStatus } : inv,
      ),
    )
    setToast({
      id: Date.now(),
      message: `Invoice ${openInvoice.supplierInvoiceNumber} → ${toStatus}`,
    })
    return historyEntry
  }

  function handleExport(format) {
    const cols = [
      { header: 'Date', key: 'date' },
      { header: 'Contractor', key: 'user' },
      { header: 'Hours', key: 'hours' },
      { header: 'Project', key: 'project' },
      { header: 'Client', key: 'client' },
      { header: 'Task', key: 'task' },
      { header: 'Task #', key: 'taskNumber' },
      { header: 'Description', key: 'description' },
      { header: 'Billing Status', key: 'billingStatus' },
      { header: 'Zoho Status', key: 'status' },
    ]
    const exportRows = visibleEntries.map((e) => ({ ...e, billingStatus: getBillingStatus(e) }))
    exportGrid({ rows: exportRows, columns: cols, title: 'Time Entries', gridName: 'time_entries', format, generatedBy: user?.email ?? '' })
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
            <span className="masthead__kicker">Payment management · Contractors</span>
            <span className="masthead__rule" aria-hidden="true" />
          </div>
          <h1 className="masthead__title">Payment</h1>
          <p className="masthead__sub">
            Review the hours logged per contractor, select the corresponding
            entries and process the payment.
          </p>
        </motion.header>

        {status === 'loading' && <LoadingState />}

        {status === 'error' && (
          <ErrorState onRetry={() => setReloadKey((key) => key + 1)} />
        )}

        {status === 'ready' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.05 }}
          >
            <Stepper
              approvedHours={stepperMetrics.approvedHours}
              invoicedHours={stepperMetrics.invoicedHours}
              collectedHours={stepperMetrics.collectedHours}
              paidHours={stepperMetrics.paidHours}
            />

            <ViewTabs
              active={activeTab}
              onChange={setActiveTab}
              pendingCount={pendingCount}
              allCount={allCount}
            />

            <FilterBar
              contractors={users}
              clients={clients}
              projects={projects}
              filters={filters}
              toggleValue={toggleValue}
              setField={setField}
              clear={clear}
              isActive={isActive}
              counts={statusCounts}
              isMobile={isMobile}
            />

            <div className="toolbar">
              <div className="toolbar__left">
                <button
                  type="button"
                  className="btn btn--ghost btn--refresh"
                  onClick={handleRefresh}
                  disabled={syncing}
                  aria-busy={syncing}
                  aria-label={syncing ? 'Syncing…' : 'Refresh now'}
                  title="Force a Zoho sync and reload the grid"
                >
                  <RefreshCw
                    size={15}
                    className={syncing ? 'icon-spin' : ''}
                    aria-hidden="true"
                  />
                  <span>{syncing ? 'Syncing…' : 'Refresh now'}</span>
                </button>
                <SyncStatus
                  status={syncStatus}
                  onOpenLog={() => setSyncLogOpen(true)}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <ExportDropdown onExport={handleExport} />
                <span className="toolbar__count">
                  {visibleEntries.length}{' '}
                  {visibleEntries.length === 1 ? 'entry' : 'entries'}
                </span>
              </div>
            </div>

            <div className="selbar-wrap">
              <SelectionBar
                count={selectedEntries.length}
                hours={selectedHours}
                users={selectedUsers}
                canBill={canBill}
                onBill={() => setModalOpen(true)}
              />
            </div>

            {visibleEntries.length === 0 ? (
              <EmptyState tab={activeTab} />
            ) : isMobile ? (
              <EntriesCards
                entries={visibleEntries}
                selectedIds={selectedIds}
                onToggle={toggleEntry}
                getInvoice={getInvoice}
                onOpenInvoice={setOpenInvoiceId}
                justInvoicedIds={justInvoicedIds}
              />
            ) : (
              <EntriesTable
                entries={visibleEntries}
                selectedIds={selectedIds}
                onToggle={toggleEntry}
                onToggleAll={toggleAllVisible}
                headerChecked={allVisibleSelected}
                headerIndeterminate={someVisibleSelected && !allVisibleSelected}
                getInvoice={getInvoice}
                onOpenInvoice={setOpenInvoiceId}
                justInvoicedIds={justInvoicedIds}
              />
            )}

            <footer className="app__footer">
              <p>
                Payments are processed in the accounting system. This app is a
                review and recording view — all data access is isolated in{' '}
                <code>src/lib/data.js</code>.
              </p>
              <div className="app__footer-brand">
                <img
                  src="/logo-southpoint.png"
                  alt="Southpoint Tech Labs"
                  className="app__footer-logo"
                />
              </div>
            </footer>
          </motion.div>
        )}

      <AnimatePresence>
        {modalOpen && canBill && (
          <BillModal
            key="bill-modal"
            user={selectedUsers[0]}
            entries={selectedEntries}
            hours={selectedHours}
            onClose={() => setModalOpen(false)}
            onConfirm={handleConfirmBill}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {openInvoice && (
          <InvoiceDetailDrawer
            key={`invoice-${openInvoice.id}`}
            invoice={openInvoice}
            entries={openInvoiceEntries}
            onClose={() => setOpenInvoiceId(null)}
            onChangeStatus={handleChangeInvoiceStatus}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {syncLogOpen && (
          <SyncLogModal
            key="synclog-modal"
            onClose={() => setSyncLogOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <Toast
            key={toast.id}
            message={toast.message}
            tone={toast.tone}
            onDismiss={() => setToast(null)}
          />
        )}
      </AnimatePresence>
    </>
  )
}

/* --- Estados auxiliares ---------------------------------------------------- */

function LoadingState() {
  return (
    <div className="state">
      <div className="skeleton-table">
        {Array.from({ length: 6 }).map((_, index) => (
          <div className="skeleton-row" key={index}>
            <span className="sk sk--check" />
            <span className="sk sk--avatar" />
            <span className="sk sk--line" />
            <span className="sk sk--line sk--short" />
          </div>
        ))}
      </div>
      <p className="state__hint">Loading entries…</p>
    </div>
  )
}

function ErrorState({ onRetry }) {
  return (
    <div className="state state--error">
      <AlertTriangle size={28} strokeWidth={1.8} />
      <h2 className="state__title">We couldn't load the entries</h2>
      <p className="state__text">Check your connection and try again.</p>
      <button type="button" className="btn btn--ghost" onClick={onRetry}>
        <RefreshCw size={15} />
        Retry
      </button>
    </div>
  )
}

function EmptyState({ tab }) {
  return (
    <div className="empty">
      {tab === 'pending'
        ? 'No entries pending to bill.'
        : 'No time entries for this contractor.'}
    </div>
  )
}
