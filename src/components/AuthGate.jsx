import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { LoginScreen } from './LoginScreen'
import { AccessDenied } from './AccessDenied'
import { NodeLoader } from './NodeLoader'
import { hasAnyRole } from '../lib/permissions'

export function AuthGate({ children }) {
  const [authStatus, setAuthStatus] = useState('loading') // 'loading' | 'authed' | 'anon'
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [appConfig, setAppConfig] = useState(null)
  const [provisionDone, setProvisionDone] = useState(false)

  useEffect(() => {
    let cancelled = false

    api.auth.getSession()
      .then((currentSession) => {
        if (cancelled) return
        setSession(currentSession)
        setAuthStatus(currentSession ? 'authed' : 'anon')
      })
      .catch((err) => {
        // Sin catch, un getSession() que rechaza dejaba authStatus en 'loading'
        // para siempre (splash infinito). Caemos a 'anon' → LoginScreen, que deja
        // reintentar el sign-in.
        if (cancelled) return
        console.error('No se pudo obtener la sesión:', err)
        setAuthStatus('anon')
      })

    const unsubscribe = api.auth.onAuthStateChange((nextSession) => {
      setSession(nextSession)
      setAuthStatus(nextSession ? 'authed' : 'anon')
      if (!nextSession) {
        setProfile(null)
        setAppConfig(null)
        setProvisionDone(false)
      }
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  // JIT provisioning: fetch roles + app config after auth
  useEffect(() => {
    if (authStatus !== 'authed' || !session || provisionDone) return
    let cancelled = false
    Promise.all([api.auth.provisionCurrentUser(), api.auth.getAppConfig()])
      .then(([prof, cfg]) => {
        if (cancelled) return
        setProfile(prof)
        setAppConfig(cfg)
        setProvisionDone(true)
      })
      .catch((err) => {
        if (cancelled) return
        console.error('Provision failed:', err)
        setProfile({ roles: [] })
        setAppConfig({ permissionsEnforced: false, sessionMaxHours: 8, adminBootstrapEmail: null })
        setProvisionDone(true)
      })
    return () => {
      cancelled = true
    }
  }, [authStatus, session, provisionDone])

  async function signOut() {
    await api.auth.signOut()
  }

  if (authStatus === 'loading' || (authStatus === 'authed' && !provisionDone)) {
    return <AuthBootSplash />
  }
  if (authStatus === 'anon') return <LoginScreen />
  if (appConfig?.permissionsEnforced && !hasAnyRole(profile?.roles)) {
    return (
      <AccessDenied
        adminEmail={appConfig.adminBootstrapEmail}
        onSignOut={signOut}
      />
    )
  }

  return children({ user: session?.user, profile, appConfig, signOut })
}

function AuthBootSplash() {
  return (
    <div className="auth-boot">
      <NodeLoader label="Loading session…" />
      <span className="auth-boot__label" aria-hidden="true">Loading session…</span>
    </div>
  )
}
