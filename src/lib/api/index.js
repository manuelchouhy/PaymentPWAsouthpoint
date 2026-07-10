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
