import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Clock,
  Building2,
  FolderKanban,
  Landmark,
  CreditCard,
  FileText,
  GitBranch,
  ScrollText,
  Mail,
  LogOut,
  Check,
  ListChecks,
  Receipt,
  PieChart,
  Gauge,
  FileSearch,
} from 'lucide-react'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true, Icon: LayoutDashboard },
  { to: '/time-entries', label: 'Time Entries', Icon: Clock },
  { to: '/clients', label: 'Clients', Icon: Building2 },
  { to: '/projects', label: 'Projects and SOW', Icon: FolderKanban },
  { to: '/entries', label: 'Entries', Icon: ListChecks },
  { to: '/billing', label: 'Billing', Icon: Receipt },
  { to: '/client-summary', label: 'Client Summary', Icon: PieChart },
  { to: '/capacity', label: 'Capacity', Icon: Gauge },
  { to: '/client-detail', label: 'Client Detail', Icon: FileSearch },
  { to: '/collections', label: 'Collections', Icon: Landmark },
  { to: '/payments', label: 'Payments', Icon: CreditCard },
  { to: '/supplier-contracts', label: 'Supplier Contracts', Icon: FileText },
  { to: '/traceability', label: 'Traceability', Icon: GitBranch },
]

const ADMIN_NAV_ITEMS = [
  { to: '/audit-log', label: 'Audit Log', Icon: ScrollText },
  { to: '/email-outbox', label: 'Email Outbox', Icon: Mail },
]

export function Sidebar({ can, open, onNavigate, user, profile, onSignOut }) {
  return (
    <aside className={`sidebar${open ? ' is-open' : ''}`}>
      <div className="sidebar__brand">
        <img
          src="/logo-southpoint.png"
          alt="Southpoint Tech Labs"
          className="sidebar__logo"
        />
      </div>
      <nav className="sidebar__nav" aria-label="Sections">
        {NAV_ITEMS.map(({ to, label, end, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              `sidebar__link${isActive ? ' is-active' : ''}`
            }
          >
            <Icon size={18} aria-hidden="true" />
            <span className="sidebar__label">{label}</span>
          </NavLink>
        ))}
        {can('settings.view') && (
          <>
            <span className="sidebar__nav-divider" aria-hidden="true" />
            {ADMIN_NAV_ITEMS.map(({ to, label, Icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={onNavigate}
                className={({ isActive }) =>
                  `sidebar__link${isActive ? ' is-active' : ''}`
                }
              >
                <Icon size={18} aria-hidden="true" />
                <span className="sidebar__label">{label}</span>
              </NavLink>
            ))}
          </>
        )}
      </nav>
      {user && <SidebarUser user={user} profile={profile} onSignOut={onSignOut} />}
    </aside>
  )
}

// Ventana para confirmar el sign out con un segundo click (evita el logout
// accidental de un solo click reportado en QA — el botón está pegado justo
// debajo del nombre de usuario).
const SIGNOUT_CONFIRM_MS = 3000

function SidebarUser({ user, profile, onSignOut }) {
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const confirmTimer = useRef(null)
  const label =
    profile?.fullName ||
    user?.user_metadata?.name ||
    user?.user_metadata?.full_name ||
    user?.email ||
    'User'
  const initial = label.trim().charAt(0).toUpperCase() || '?'

  useEffect(() => () => clearTimeout(confirmTimer.current), [])

  async function handleSignOut() {
    if (busy) return
    if (!confirming) {
      setConfirming(true)
      confirmTimer.current = setTimeout(() => setConfirming(false), SIGNOUT_CONFIRM_MS)
      return
    }
    clearTimeout(confirmTimer.current)
    setBusy(true)
    try {
      await onSignOut?.()
    } catch (error) {
      console.error('No se pudo cerrar sesión:', error)
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <div className="sidebar__user">
      <span className="user-pill__avatar" aria-hidden="true">
        {initial}
      </span>
      <span className="user-pill__label" title={label}>
        {label}
      </span>
      <button
        type="button"
        className={`user-pill__logout${confirming ? ' user-pill__logout--confirm' : ''}`}
        onClick={handleSignOut}
        onBlur={() => setConfirming(false)}
        disabled={busy}
        aria-label={confirming ? 'Click again to confirm sign out' : 'Sign out'}
        title={confirming ? 'Click again to confirm' : 'Sign out'}
      >
        {confirming ? <Check size={14} aria-hidden="true" /> : <LogOut size={14} aria-hidden="true" />}
      </button>
    </div>
  )
}

export { NAV_ITEMS, ADMIN_NAV_ITEMS }
