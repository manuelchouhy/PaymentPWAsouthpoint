/**
 * Punto único de acceso a la capa de datos. El cliente activo se elige por
 * la variable de entorno VITE_API_MODE:
 *   - 'supabase' (default) → src/lib/api/supabase-client.js
 *   - 'http'               → src/lib/api/http-client.js (backend Node de Claudio)
 *
 * Los componentes importan `api` desde acá y nunca el cliente concreto.
 */
import { supabaseApiClient } from './supabase-client'
import { httpApiClient } from './http-client'

const API_MODE = import.meta.env.VITE_API_MODE === 'http' ? 'http' : 'supabase'

export const api = API_MODE === 'http' ? httpApiClient : supabaseApiClient

// Expone el cliente en window solo en modo test (Prompt R2): Playwright corre
// en un contexto Node aparte y no puede importar este módulo ESM directamente
// (usa import.meta.env), así que llama a api.test.* vía page.evaluate().
if (import.meta.env.VITE_TEST_MODE === 'true' && typeof window !== 'undefined') {
  window.__api = api
}
