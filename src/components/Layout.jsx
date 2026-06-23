import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { rolesLabel } from '../lib/permissions'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/time-entries', label: 'Time Entries' },
  { to: '/projects', label: 'Projects & Contracts' },
  { to: '/collections', label: 'Collections' },
  { to: '/payments', label: 'Payments' },
  { to: '/supplier-contracts', label: 'Supplier Contracts' },
  { to: '/traceability', label: 'Traceability' },
]

const ADMIN_NAV_ITEMS = [
  { to: '/audit-log', label: 'Audit Log' },
  { to: '/email-outbox', label: 'Email Outbox' },
]

export function Layout({ user, profile, can, onSignOut }) {
  const rolesBadge = rolesLabel(profile?.roles ?? [])

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__inner">
          <img
            src="/logo-southpoint.png"
            alt="Southpoint Tech Labs"
            className="topbar__logo"
          />
          <nav className="topnav" aria-label="Sections">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `topnav__link${isActive ? ' is-active' : ''}`
                }
              >
                {item.label}
              </NavLink>
            ))}
            {ADMIN_NAV_ITEMS.filter(() => can('settings.view')).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `topnav__link${isActive ? ' is-active' : ''}`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="topbar__right">
            {rolesBadge !== 'No role' && (
              <span className="masthead__badge">{rolesBadge}</span>
            )}
            {user && <UserPill user={user} profile={profile} onSignOut={onSignOut} />}
          </div>
        </div>
      </header>

      <div className="app__inner">
        <Outlet context={{ user, profile, can, onSignOut }} />
      </div>
    </div>
  )
}

function UserPill({ user, profile, onSignOut }) {
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
        aria-label="Sign out"
        title="Sign out"
      >
        <LogOut size={14} aria-hidden="true" />
        <span>Sign out</span>
      </button>
    </div>
  )
}
