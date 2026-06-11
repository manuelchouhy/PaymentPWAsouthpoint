import { useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { LoginScreen } from './LoginScreen'

const DEMO_USER = {
  id: 'demo-user',
  email: 'demo@southpoint.local',
  user_metadata: { name: 'Demo' },
}

export function AuthGate({ children }) {
  const [status, setStatus] = useState('loading') // 'loading' | 'authed' | 'anon'
  const [session, setSession] = useState(null)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setSession({ user: DEMO_USER })
      setStatus('authed')
      return
    }

    let cancelled = false

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSession(data.session)
      setStatus(data.session ? 'authed' : 'anon')
    })

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        setSession(nextSession)
        setStatus(nextSession ? 'authed' : 'anon')
      },
    )

    return () => {
      cancelled = true
      subscription?.subscription?.unsubscribe()
    }
  }, [])

  async function signOut() {
    if (!isSupabaseConfigured) return
    await supabase.auth.signOut()
  }

  if (status === 'loading') return <AuthBootSplash />
  if (status === 'anon') return <LoginScreen />

  return children({ user: session?.user, signOut })
}

function AuthBootSplash() {
  return (
    <div className="auth-boot" role="status" aria-live="polite">
      <div className="auth-boot__dot" aria-hidden="true" />
      <span className="auth-boot__label">Loading session…</span>
    </div>
  )
}
