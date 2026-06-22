import { motion } from 'framer-motion'
import { ShieldAlert, LogOut } from 'lucide-react'

/**
 * Pantalla de acceso denegado (FR-11): el usuario autenticó correctamente
 * pero no tiene ningún rol/grupo que le permita usar la app.
 *
 * @param {{ adminEmail?: string, onSignOut?: () => void }} props
 */
export function AccessDenied({ adminEmail, onSignOut }) {
  const contact = adminEmail || 'your administrator'
  return (
    <div className="login">
      <motion.div
        className="login__card"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="login__brand">
          <img
            src="/logo-southpoint.png"
            alt="Southpoint Tech Labs"
            className="login__logo"
          />
        </div>

        <div className="login__kicker-row">
          <span className="login__kicker">Access restricted</span>
          <span className="login__rule" aria-hidden="true" />
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            margin: '4px 0 2px',
          }}
        >
          <ShieldAlert size={22} aria-hidden="true" style={{ color: 'var(--warn, #f59e0b)' }} />
          <h1 className="login__title" style={{ margin: 0 }}>
            No access
          </h1>
        </div>

        <p className="login__sub">
          Your account authenticated correctly but you don&apos;t have permission
          to use this application. Contact{' '}
          <strong>{contact}</strong> to request access.
        </p>

        <button
          type="button"
          className="login__ms-btn"
          onClick={onSignOut}
        >
          <LogOut size={16} aria-hidden="true" />
          <span>Sign out</span>
        </button>

        <div className="login__footnote">
          Secure session via Supabase Auth · Azure / Entra ID
        </div>
      </motion.div>
    </div>
  )
}
