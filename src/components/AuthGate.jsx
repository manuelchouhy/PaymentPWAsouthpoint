import { useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { LoginScreen } from './LoginScreen'
import { AccessDenied } from './AccessDenied'
import { provisionCurrentUser, getAppConfig } from '../lib/authData'
import { hasAnyRole } from '../lib/permissions'

const DEMO_USER = {
  id: 'demo-user',
  email: 'demo@southpoint.local',
  user_metadata: { name: 'Demo' },
}

const DEMO_PROFILE = {
  id: 'demo',
  email: 'demo@southpoint.local',
  fullName: 'Demo',
  roles: ['Administrator'],
  isActive: true,
}

const DEMO_CONFIG = {
  permissionsEnforced: false,
  sessionMaxHours: 8,
  adminBootstrapEmail: null,
}

export function AuthGate({ children }) {
  const [authStatus, setAuthStatus] = useState('loading') // 'loading' | 'authed' | 'anon'
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [appConfig, setAppConfig] = useState(null)
  const [provisionDone, setProvisionDone] = useState(false)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setSession({ user: DEMO_USER })
      setAuthStatus('authed')
      setProfile(DEMO_PROFILE)
      setAppConfig(DEMO_CONFIG)
      setProvisionDone(true)
      return
    }

    let cancelled = false

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSession(data.session)
      setAuthStatus(data.session ? 'authed' : 'anon')
    })

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        setSession(nextSession)
        setAuthStatus(nextSession ? 'authed' : 'anon')
        if (!nextSession) {
          setProfile(null)
          setAppConfig(null)
          setProvisionDone(false)
        }
      },
    )

    return () => {
      cancelled = true
      subscription?.subscription?.unsubscribe()
    }
  }, [])

  // JIT provisioning: fetch roles + app config after auth
  useEffect(() => {
    if (authStatus !== 'authed' || !session || provisionDone || !isSupabaseConfigured) return
    let cancelled = false
    Promise.all([provisionCurrentUser(), getAppConfig()])
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
        setAppConfig(DEMO_CONFIG)
        setProvisionDone(true)
      })
    return () => {
      cancelled = true
    }
  }, [authStatus, session, provisionDone])

  async function signOut() {
    if (!isSupabaseConfigured) return
    await supabase.auth.signOut()
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
    <div className="auth-boot" role="status" aria-live="polite">
      <div className="auth-boot__dot" aria-hidden="true" />
      <span className="auth-boot__label">Loading session…</span>
    </div>
  )
}
