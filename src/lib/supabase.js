import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// VITE_FORCE_MOCK=true fuerza el modo demo con datos mock aunque las
// credenciales de Supabase estén presentes en el entorno de build. Se usa para
// el bundle de DOMO (vite.config.domo.js): la app queda sin login, sin backend
// (cero llamadas de datos a Supabase/HTTP) y sin credenciales embebidas. Nota:
// index.html todavía carga Google Fonts por CDN (best-effort); si la CSP del
// iframe de DOMO la bloquea, la tipografía cae a la fuente del sistema.
// Fuente única del modo mock: la consumen tanto isSupabaseConfigured como el
// router en main.jsx (HashRouter en DOMO). No re-leer el env por separado.
export const isMockMode = import.meta.env.VITE_FORCE_MOCK === 'true'

export const isSupabaseConfigured = !isMockMode && Boolean(url && anonKey)

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    })
  : null

if (!isSupabaseConfigured && typeof window !== 'undefined') {
  console.warn(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY no definidas — ' +
      'la app corre en modo demo con datos mock.',
  )
}
