import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import confetti from 'canvas-confetti'
import { AlertTriangle, LogOut, RefreshCw } from 'lucide-react'
import { createPayment, getPayments, getTimeEntries, triggerSync } from './lib/data'
import { useMediaQuery } from './lib/useMediaQuery'
import { formatHours } from './lib/format'
import { UserFilter } from './components/UserFilter'
import { SelectionBar } from './components/SelectionBar'
import { Stepper } from './components/Stepper'
import { EntriesTable } from './components/EntriesTable'
import { EntriesCards } from './components/EntriesCards'
import { PaymentModal } from './components/PaymentModal'
import { Toast } from './components/Toast'

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

export default function App({ user, onSignOut }) {
  const [entries, setEntries] = useState([])
  const [payments, setPayments] = useState([])
  const [status, setStatus] = useState('loading') // 'loading' | 'ready' | 'error'
  const [reloadKey, setReloadKey] = useState(0)

  const [userFilter, setUserFilter] = useState('all')
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [modalOpen, setModalOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const [syncing, setSyncing] = useState(false)

  const isMobile = useMediaQuery('(max-width: 720px)')

  // --- Carga de datos (entries + payments en paralelo) ----------------------
  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    Promise.all([getTimeEntries(), getPayments()])
      .then(([entriesData, paymentsData]) => {
        if (cancelled) return
        setEntries(entriesData)
        setPayments(paymentsData)
        setStatus('ready')
      })
      .catch((error) => {
        if (cancelled) return
        console.error('No se pudieron cargar las entradas:', error)
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  // --- Mapa entryId -> info de pago (recalculado cuando cambian payments) ---
  const paymentByEntryId = useMemo(() => {
    const map = new Map()
    for (const payment of payments) {
      for (const entryId of payment.entryIds) {
        map.set(entryId, {
          invoiceNumber: payment.invoiceNumber,
          transactionNumber: payment.transactionNumber,
        })
      }
    }
    return map
  }, [payments])

  const getPayment = useCallback(
    (entryId) => paymentByEntryId.get(entryId) ?? null,
    [paymentByEntryId],
  )

  // --- Derivados ------------------------------------------------------------
  const users = useMemo(
    () =>
      [...new Set(entries.map((entry) => entry.user))].sort((a, b) =>
        a.localeCompare(b, 'es'),
      ),
    [entries],
  )

  const visibleEntries = useMemo(
    () =>
      userFilter === 'all'
        ? entries
        : entries.filter((entry) => entry.user === userFilter),
    [entries, userFilter],
  )

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

  // --- Métricas del stepper (sobre TODAS las entries, no las filtradas) -----
  const stepperMetrics = useMemo(() => {
    let approvedHours = 0
    let paidHours = 0
    for (const entry of entries) {
      if (entry.status !== 'Approved') continue
      approvedHours += entry.hours
      if (paymentByEntryId.has(entry.id)) paidHours += entry.hours
    }
    return { approvedHours, paidHours }
  }, [entries, paymentByEntryId])

  // Regla clave: sólo se puede pagar si hay selección y de un único proveedor.
  const canPay = selectedEntries.length > 0 && selectedUsers.length === 1

  // "Seleccionable" = no está pagada ya
  const isSelectable = useCallback(
    (entry) => !paymentByEntryId.has(entry.id),
    [paymentByEntryId],
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
    // Defensa extra: nunca togglear una entrada ya pagada.
    if (paymentByEntryId.has(id)) return
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
      const [entriesData, paymentsData] = await Promise.all([
        getTimeEntries(),
        getPayments(),
      ])
      setEntries(entriesData)
      setPayments(paymentsData)
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
          ? `Sincronizado · ${result.synced} ${
              result.synced === 1 ? 'registro' : 'registros'
            }`
          : 'Sincronizado'
      setToast({ id: Date.now(), tone: 'success', message: syncedMsg })
    } catch (error) {
      console.error('No se pudo sincronizar:', error)
      setToast({
        id: Date.now(),
        tone: 'error',
        message: 'No se pudo actualizar, intentá de nuevo',
      })
    } finally {
      setSyncing(false)
    }
  }

  async function handleConfirmPayment({ invoiceNumber, transactionNumber }) {
    const paidCount = selectedEntries.length
    const paidUser = selectedUsers[0]
    const paidHoursFmt = formatHours(selectedHours)

    const { payment } = await createPayment({
      userName: paidUser,
      totalHours: selectedHours,
      invoiceNumber,
      transactionNumber,
      entryIds: selectedEntries.map((entry) => entry.id),
    })

    // Sumar el nuevo pago al estado local → las filas pagadas se marcan en vivo.
    setPayments((prev) => [payment, ...prev])
    setModalOpen(false)
    setSelectedIds(new Set())
    setToast({
      id: Date.now(),
      message: `Pago registrado — ${paidCount} ${
        paidCount === 1 ? 'entrada' : 'entradas'
      } de ${paidUser} · ${paidHoursFmt} h · Factura ${invoiceNumber}`,
    })
    fireConfetti()
  }

  return (
    <div className="app">
      <div className="app__inner">
        <motion.header
          className="masthead"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="masthead__brand">
            <img
              src="/logo-southpoint.png"
              alt="Southpoint Tech Labs"
              className="masthead__logo"
            />
            <div className="masthead__brand-right">
              <span className="masthead__badge">Solo lectura</span>
              {user && <UserPill user={user} onSignOut={onSignOut} />}
            </div>
          </div>
          <div className="masthead__top">
            <span className="masthead__kicker">Gestión de pagos · Proveedores</span>
            <span className="masthead__rule" aria-hidden="true" />
          </div>
          <h1 className="masthead__title">Time Entries</h1>
          <p className="masthead__sub">
            Revisá las horas registradas por proveedor, seleccioná las entradas
            correspondientes y procesá el pago.
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
              selectedHours={selectedHours}
              paidHours={stepperMetrics.paidHours}
            />

            <div className="toolbar">
              <div className="toolbar__left">
                <UserFilter
                  users={users}
                  value={userFilter}
                  onChange={setUserFilter}
                />
                <button
                  type="button"
                  className="btn btn--ghost btn--refresh"
                  onClick={handleRefresh}
                  disabled={syncing}
                  aria-busy={syncing}
                  aria-label={syncing ? 'Sincronizando…' : 'Actualizar ahora'}
                  title="Forzar sync de Zoho y recargar la grilla"
                >
                  <RefreshCw
                    size={15}
                    className={syncing ? 'icon-spin' : ''}
                    aria-hidden="true"
                  />
                  <span>{syncing ? 'Sincronizando…' : 'Actualizar ahora'}</span>
                </button>
              </div>
              <span className="toolbar__count">
                {visibleEntries.length}{' '}
                {visibleEntries.length === 1 ? 'entrada' : 'entradas'}
              </span>
            </div>

            <div className="selbar-wrap">
              <SelectionBar
                count={selectedEntries.length}
                hours={selectedHours}
                users={selectedUsers}
                canPay={canPay}
                onPay={() => setModalOpen(true)}
              />
            </div>

            {visibleEntries.length === 0 ? (
              <EmptyState />
            ) : isMobile ? (
              <EntriesCards
                entries={visibleEntries}
                selectedIds={selectedIds}
                onToggle={toggleEntry}
                getPayment={getPayment}
              />
            ) : (
              <EntriesTable
                entries={visibleEntries}
                selectedIds={selectedIds}
                onToggle={toggleEntry}
                onToggleAll={toggleAllVisible}
                headerChecked={allVisibleSelected}
                headerIndeterminate={someVisibleSelected && !allVisibleSelected}
                getPayment={getPayment}
              />
            )}

            <footer className="app__footer">
              <p>
                Los pagos se procesan en el sistema contable. Esta app es una
                vista de consulta y registro — todo el acceso a datos está
                aislado en <code>src/lib/data.js</code>.
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
      </div>

      <AnimatePresence>
        {modalOpen && canPay && (
          <PaymentModal
            key="payment-modal"
            user={selectedUsers[0]}
            entries={selectedEntries}
            hours={selectedHours}
            onClose={() => setModalOpen(false)}
            onConfirm={handleConfirmPayment}
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
    </div>
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
      <p className="state__hint">Cargando entradas…</p>
    </div>
  )
}

function ErrorState({ onRetry }) {
  return (
    <div className="state state--error">
      <AlertTriangle size={28} strokeWidth={1.8} />
      <h2 className="state__title">No pudimos cargar las entradas</h2>
      <p className="state__text">Revisá la conexión e intentá nuevamente.</p>
      <button type="button" className="btn btn--ghost" onClick={onRetry}>
        <RefreshCw size={15} />
        Reintentar
      </button>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="empty">No hay entradas de tiempo para este proveedor.</div>
  )
}

function UserPill({ user, onSignOut }) {
  const [busy, setBusy] = useState(false)
  const label =
    user?.user_metadata?.name ||
    user?.user_metadata?.full_name ||
    user?.email ||
    'Usuario'
  const initial = label.trim().charAt(0).toUpperCase() || '?'

  async function handleSignOut() {
    if (busy) return
    setBusy(true)
    try {
      await onSignOut?.()
    } catch (error) {
      console.error('No se pudo cerrar sesión:', error)
      setBusy(false)
    }
  }

  return (
    <div className="user-pill">
      <span className="user-pill__avatar" aria-hidden="true">
        {initial}
      </span>
      <span className="user-pill__label" title={label}>
        {label}
      </span>
      <button
        type="button"
        className="user-pill__logout"
        onClick={handleSignOut}
        disabled={busy}
        aria-label="Cerrar sesión"
        title="Cerrar sesión"
      >
        <LogOut size={14} aria-hidden="true" />
        <span>Salir</span>
      </button>
    </div>
  )
}
