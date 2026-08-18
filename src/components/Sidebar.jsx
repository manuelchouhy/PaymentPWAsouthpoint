import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
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

// Time Entries (/time-entries → App.jsx) NO está acá a propósito. Hacía lo
// mismo que Entries + Billing juntas pero sin el concepto de allocation, y era
// un segundo camino para facturar que salteaba el triage: toda factura emitida
// ahí congela entries con allocation en null. Es el origen plausible de las
// 808 h facturadas antes del triage que había en la base.
//
// La ruta sigue viva porque la suite e2e (specs 01-06) y las baselines
// visuales entran por ahí, y Billing todavía no puede reemplazarla en los
// tests: necesita entries con allocation 'bill_to_client' y hoy no hay
// ninguna. Se borra del todo cuando haya horas clasificadas y se reapunten los
// tests.
// Orden y foco de la v1 (reunión 2026-08-15): Eduardo acotó la primera versión
// a Clients, Projects and SOW, Entries, Billing y Payments. Esos cinco —más el
// Dashboard, que sigue siendo la home— van arriba y son navegables. El resto
// queda VISIBLE pero deshabilitado (`disabled: true`): Manuel lo pidió así en la
// reunión ("apagar el botón para que no se pueda apretar, pero que aparezca para
// que no confunda la vista"). No se ocultan las RUTAS a propósito: la suite e2e
// y las baselines visuales entran por `page.goto('/collections')` etc., así que
// esconder el ítem del menú no las rompe, pero borrar la ruta sí.
const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true, Icon: LayoutDashboard },
  { to: '/clients', label: 'Clients', Icon: Building2 },
  { to: '/projects', label: 'Projects and SOW', Icon: FolderKanban },
  { to: '/entries', label: 'Entries', Icon: ListChecks },
  { to: '/billing', label: 'Billing', Icon: Receipt },
  { to: '/payments', label: 'Payments', Icon: CreditCard },
  { to: '/client-summary', label: 'Client Summary', Icon: PieChart, disabled: true },
  { to: '/capacity', label: 'Capacity', Icon: Gauge, disabled: true },
  { to: '/client-detail', label: 'Client Detail', Icon: FileSearch, disabled: true },
  { to: '/collections', label: 'Collections', Icon: Landmark, disabled: true },
  { to: '/supplier-contracts', label: 'Supplier Contracts', Icon: FileText, disabled: true },
  { to: '/traceability', label: 'Traceability', Icon: GitBranch, disabled: true },
]

// Audit Log y Email Outbox tampoco son de la v1: se muestran (sólo a quien tiene
// settings.view) pero deshabilitados, igual que el resto.
const ADMIN_NAV_ITEMS = [
  { to: '/audit-log', label: 'Audit Log', Icon: ScrollText, disabled: true },
  { to: '/email-outbox', label: 'Email Outbox', Icon: Mail, disabled: true },
]

// Un ítem deshabilitado no es un NavLink: se renderiza como <span> sin destino,
// fuera del tab order (tabIndex -1) y con aria-disabled, para que ni el mouse ni
// el teclado ni un lector de pantalla lo traten como navegable. La ruta sigue
// existiendo; lo único que se apaga es este acceso desde el menú.
function SidebarItem({ item, onNavigate }) {
  const { to, label, end, Icon, disabled } = item
  if (disabled) {
    return (
      <span
        className="sidebar__link is-disabled"
        aria-disabled="true"
        tabIndex={-1}
        title="Disponible en una próxima versión"
      >
        <Icon size={18} aria-hidden="true" />
        <span className="sidebar__label">{label}</span>
      </span>
    )
  }
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) => `sidebar__link${isActive ? ' is-active' : ''}`}
    >
      <Icon size={18} aria-hidden="true" />
      <span className="sidebar__label">{label}</span>
    </NavLink>
  )
}

export function Sidebar({ can, open, onNavigate, user, profile, onSignOut }) {
  // Los cinco módulos de la v1 (+ Dashboard) arriba; los diferidos, debajo de un
  // divisor. El orden ya viene dado en NAV_ITEMS: acá sólo se parte por el flag
  // para intercalar el divisor entre ambos tramos.
  const activeItems = NAV_ITEMS.filter((item) => !item.disabled)
  const deferredItems = NAV_ITEMS.filter((item) => item.disabled)
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
        {activeItems.map((item) => (
          <SidebarItem key={item.to} item={item} onNavigate={onNavigate} />
        ))}
        {deferredItems.length > 0 && (
          <>
            <span className="sidebar__nav-divider" aria-hidden="true" />
            {deferredItems.map((item) => (
              <SidebarItem key={item.to} item={item} onNavigate={onNavigate} />
            ))}
          </>
        )}
        {can('settings.view') && (
          <>
            <span className="sidebar__nav-divider" aria-hidden="true" />
            {ADMIN_NAV_ITEMS.map((item) => (
              <SidebarItem key={item.to} item={item} onNavigate={onNavigate} />
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
