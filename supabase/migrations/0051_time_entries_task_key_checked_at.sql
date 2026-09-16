-- =============================================================================
-- Entries (2026-09-16) — marca de "ya se intentó resolver el key corto"
-- =============================================================================
-- task_key_checked_at: cuándo sync-task-keys intentó resolver el key corto de Zoho de una
-- hora (haya encontrado key o no). Sirve de NEGATIVE-CACHE: una tarea sin key en Zoho
-- (borrada, o sin key) NO se re-pide en cada corrida — se marca checked y se saltea, así la
-- función CONVERGE (deja de gastar llamadas a Zoho) en vez de re-intentar lo irresoluble.
--
-- NULL = todavía no se intentó. Sólo lo escribe sync-task-keys; puramente operativo (no lo
-- usa la UI). No destructivo e idempotente. Ver supabase/functions/sync-task-keys.
-- =============================================================================

alter table public.time_entries
  add column if not exists task_key_checked_at timestamptz;
