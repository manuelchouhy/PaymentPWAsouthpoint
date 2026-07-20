import { motion } from 'framer-motion'
import { LogOut } from 'lucide-react'
import { EmptyGraph } from './EmptyGraph'

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

        <EmptyGraph
          title="No access yet"
          hint={
            <>
              Your account authenticated correctly, but it doesn&apos;t have
              permission to use this app. Contact <strong>{contact}</strong>{' '}
              to request access.
            </>
          }
          action={
            <button type="button" className="login__ms-btn" onClick={onSignOut}>
              <LogOut size={16} aria-hidden="true" />
              <span>Sign out</span>
            </button>
          }
        />

        <div className="login__footnote">
          Secure session via Supabase Auth · Azure / Entra ID
        </div>
      </motion.div>
    </div>
  )
}
