import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { LogOut } from 'lucide-react'

const NAV_ITEMS = [
  { to: '/', label: 'Payment', end: true },
  { to: '/projects', label: 'Projects & Contracts' },
  { to: '/collections', label: 'Collections' },
  { to: '/payments', label: 'Payments' },
  { to: '/supplier-contracts', label: 'Supplier Contracts' },
]

/**
 * Shell de la app: barra superior con logo, navegación entre secciones y el
 * pill de usuario. El contenido de cada ruta se renderiza en el <Outlet>.
 * El `user` / `onSignOut` se exponen vía outlet context a las páginas.
 */
export function Layout({ user, onSignOut }) {
  return (
    <div className="app">
      <div className="app__inner">
        <header className="topbar">
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
          </nav>
          <div className="topbar__right">
            <span className="masthead__badge">Read only</span>
            {user && <UserPill user={user} onSignOut={onSignOut} />}
          </div>
        </header>

        <Outlet context={{ user, onSignOut }} />
      </div>
    </div>
  )
}

function UserPill({ user, onSignOut }) {
  const [busy, setBusy] = useState(false)
  const label =
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
