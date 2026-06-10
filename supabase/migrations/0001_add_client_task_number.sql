-- =============================================================================
-- Migración FR-02 · agregar columnas `client` y `task_number` a time_entries
-- =============================================================================
-- Segura para correr sobre una base que YA tiene datos: `add column ... if not
-- exists` no toca las filas existentes (quedan con NULL en las nuevas columnas).
--
-- No hace falta backfill manual: el próximo sync de Zoho completa `client` y
-- `task_number` automáticamente, porque la Edge Function `sync-time-logs` hace
-- upsert por `zoho_log_id` (idempotente) y reescribe ambas columnas.
--
-- Cómo correrlo: Supabase → SQL Editor → pegar y ejecutar.
-- =============================================================================

alter table public.time_entries
  add column if not exists client      text,   -- cliente del proyecto (Zoho)
  add column if not exists task_number text;   -- id numérico de la tarea (Zoho)
