import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'

/**
 * Ruta exclusiva de VITE_TEST_MODE=true (Prompt R2). Setea una sesión mock de
 * Admin y redirige — Playwright entra por acá en vez del SSO real de Microsoft.
 * Navega recién después de que la sesión quedó escrita (evita una carrera con
 * el primer render de AuthGate en "/").
 */
export function TestLoginPage() {
  const navigate = useNavigate()

  useEffect(() => {
    api.test.login().then(() => navigate('/', { replace: true }))
  }, [navigate])

  return null
}
