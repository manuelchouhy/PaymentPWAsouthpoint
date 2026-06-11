import { useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'

export function LoginScreen() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function handleMicrosoftLogin() {
    if (!isSupabaseConfigured) {
      setError(
        'Supabase is not configured in this environment. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
      )
      return
    }
    setError(null)
    setLoading(true)
    try {
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: 'azure',
        options: {
          scopes: 'openid email profile',
          redirectTo: window.location.origin,
        },
      })
      if (authError) throw authError
      // El navegador hace redirect al IdP — no llegamos a "loading=false" en éxito.
    } catch (err) {
      console.error('No se pudo iniciar sesión:', err)
      setError('Could not sign in. Please try again in a few seconds.')
      setLoading(false)
    }
  }

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
          <span className="login__kicker">Payment management · Contractors</span>
          <span className="login__rule" aria-hidden="true" />
        </div>

        <h1 className="login__title">Sign in</h1>
        <p className="login__sub">
          Restricted access. Sign in with your Microsoft corporate account
          to continue.
        </p>

        <button
          type="button"
          className="login__ms-btn"
          onClick={handleMicrosoftLogin}
          disabled={loading}
          aria-busy={loading}
        >
          {loading ? (
            <>
              <Loader2 size={16} className="icon-spin" aria-hidden="true" />
              <span>Redirecting to Microsoft…</span>
            </>
          ) : (
            <>
              <MicrosoftLogo />
              <span>Sign in with Microsoft</span>
            </>
          )}
        </button>

        {error && (
          <div className="login__error" role="alert">
            <AlertTriangle size={14} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <div className="login__footnote">
          Secure session via Supabase Auth · Azure / Entra ID
        </div>
      </motion.div>
    </div>
  )
}

function MicrosoftLogo() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 23 23"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="1" y="1" width="10" height="10" fill="#F25022" />
      <rect x="12" y="1" width="10" height="10" fill="#7FBA00" />
      <rect x="1" y="12" width="10" height="10" fill="#00A4EF" />
      <rect x="12" y="12" width="10" height="10" fill="#FFB900" />
    </svg>
  )
}
