-- =============================================================================
-- Entries (2026-09-15) — key corto de Zoho por hora, SÓLO para display
-- =============================================================================
-- Agrega time_entries.task_key: el `key` corto de la tarea en Zoho (ej. "HSS-I12"),
-- el número "humano" del portal, distinto del task_number largo (id interno de 19
-- dígitos, ej. "2236753000000193417"). La UI muestra el corto y cae al largo si falta.
--
-- IMPORTANTE: NO reemplaza a task_number. Toda la lógica (matching hora→task, stages,
-- dedup de facturas) sigue usando task_number, el id largo y estable. Esta columna es
-- puramente de presentación. Nullable, sin backfill: queda NULL en filas viejas hasta el
-- próximo sync (sync-time-logs la puebla desde task.key de Zoho). No destructivo e idempotente.
--
-- ORDEN DE DEPLOY (stacked): esta migración debe aplicarse ANTES de deployar el frontend,
-- porque getTimeEntries()/getProjectLoggedTasks() ya piden la columna en su SELECT.
-- =============================================================================

alter table public.time_entries
  add column if not exists task_key text;
