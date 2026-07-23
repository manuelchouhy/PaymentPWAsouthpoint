import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { ChevronDown, LogOut, Menu } from 'lucide-react'
import { ThemeToggle } from './ThemeToggle'
import { SyncStatus } from './SyncStatus'
import { SyncLogModal } from './SyncLogModal'
import { NAV_ITEMS, ADMIN_NAV_ITEMS } from './Sidebar'
import { api } from '../lib/api'

const ALL_ITEMS = [...NAV_ITEMS, ...ADMIN_NAV_ITEMS]
const SYNC_POLL_MS = 60000

// Rutas de configuración de alertas: no están en el sidebar (se accede desde
// un link dentro de cada pantalla), pero el breadcrumb del header las
// necesita igual — si no, quedaban mostrando "Dashboard" (bug reportado).
const EXTRA_BREADCRUMBS = [
  { to: '/contract-alerts', label: 'Contract Alert Settings' },
  { to: '/collection-alerts', label: 'Collection Alert Settings' },
  { to: '/payment-alerts', label: 'Payment Alert Settings' },
  { to: '/supplier-alerts', label: 'Supplier Alert Settings' },
]

function useBreadcrumb() {
  const { pathname } = useLocation()
  const match =
    ALL_ITEMS.find((item) =>
      item.end ? pathname === item.to : pathname.startsWith(item.to),
    ) ?? EXTRA_BREADCRUMBS.find((item) => pathname.startsWith(item.to))
  return match?.label ?? 'Dashboard'
}

export function Header({ rolesBadge, onToggleSidebar, user, profile, onSignOut }) {
  const breadcrumb = useBreadcrumb()
  const [syncStatus, setSyncStatus] = useState(null)
  const [syncLogOpen, setSyncLogOpen] = useState(false)

  // Estado de sync global (tabla única en Supabase): se muestra en el header
  // para que sea visible desde cualquier pantalla, no solo en Time Entries.
  useEffect(() => {
    let cancelled = false
    function load() {
      api.sync.getStatus()
        .then((data) => {
          if (!cancelled) setSyncStatus(data)
        })
        .catch(() => {})
    }
    load()
    const timer = setInterval(load, SYNC_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return (
    <header className="app-header">
      <button
        type="button"
        className="app-header__menu-btn"
        onClick={onToggleSidebar}
        aria-label="Toggle navigation"
      >
        <Menu size={18} aria-hidden="true" />
      </button>
      <span className="app-header__breadcrumb">{breadcrumb}</span>
      <div className="app-header__right">
        {rolesBadge !== 'No role' && (
          <span className="masthead__badge">{rolesBadge}</span>
        )}
        <SyncStatus status={syncStatus} onOpenLog={() => setSyncLogOpen(true)} />
        <ThemeToggle />
        {user && (
          <HeaderUserMenu user={user} profile={profile} onSignOut={onSignOut} />
        )}
      </div>

      <AnimatePresence>
        {syncLogOpen && (
          <SyncLogModal
            key="header-synclog-modal"
            onClose={() => setSyncLogOpen(false)}
          />
        )}
      </AnimatePresence>
    </header>
  )
}

function HeaderUserMenu({ user, profile, onSignOut }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const wrapRef = useRef(null)

  const label =
    profile?.fullName ||
    user?.user_metadata?.name ||
    user?.user_metadata?.full_name ||
    user?.email ||
    'User'
  const initial = label.trim().charAt(0).toUpperCase() || '?'

  useEffect(() => {
    if (!open) return
    function close(event) {
      if (!wrapRef.current?.contains(event.target)) setOpen(false)
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

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
    <div ref={wrapRef} className="header-user">
      <button
        type="button"
        className="user-pill header-user__trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="user-pill__avatar" aria-hidden="true">
          {initial}
        </span>
        <span className="user-pill__label" title={label}>
          {label}
        </span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open && (
        <div className="header-user__menu" role="menu">
          <span className="header-user__email">{user?.email}</span>
          <button
            type="button"
            role="menuitem"
            className="header-user__signout"
            onClick={handleSignOut}
            disabled={busy}
          >
            <LogOut size={14} aria-hidden="true" />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
