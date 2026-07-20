import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Clock,
  FolderKanban,
  Landmark,
  CreditCard,
  FileText,
  GitBranch,
  ScrollText,
  Mail,
  LogOut,
} from 'lucide-react'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true, Icon: LayoutDashboard },
  { to: '/time-entries', label: 'Time Entries', Icon: Clock },
  { to: '/projects', label: 'Projects & Contracts', Icon: FolderKanban },
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

function SidebarUser({ user, profile, onSignOut }) {
  const [busy, setBusy] = useState(false)
  const label =
    profile?.fullName ||
    user?.user_metadata?.name ||
    user?.user_metadata?.full_name ||
    user?.email ||
    'User'
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
    <div className="sidebar__user">
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
        aria-label="Sign out"
        title="Sign out"
      >
        <LogOut size={14} aria-hidden="true" />
      </button>
    </div>
  )
}

export { NAV_ITEMS, ADMIN_NAV_ITEMS }
