-- =============================================================================
-- Código corto de la task: columna `task_key` en time_entries (2026-09-16)
-- =============================================================================
-- DRAFT / GATED — NO aplicar sin aprobación humana explícita. No destructivo,
-- idempotente (solo ADD COLUMN).
--
-- Feature task-key-display (slice 01). Hoy el front muestra el id INTERNO largo de
-- Zoho (time_entries.task_number, ~19 dígitos). El usuario quiere ver el código corto
-- legible de Zoho (task.key, ej. "PP1-T1", la columna "ID" de Zoho Projects).
--
-- Ese `key` NO viene en el payload de time-logs (solo trae name/id_string/id); vive en
-- la Tasks API. La edge function `sync-task-keys` (desacoplada del sync de horas) lo
-- trae y lo guarda acá.
--
--   * time_entries.task_key : key LEGIBLE de Zoho (ej. "PP1-T1"), SOLO DISPLAY. NO se
--     usa para joins — la llave hora↔task sigue siendo task_number (id largo). Igual
--     concepto que project_stages.zoho_task_key (ver migración 0048 y CONTEXT.md →
--     Task id vs Task key).
--   * NULL/'' = aún sin resolver (o task sin key en Zoho); el front cae al fallback "—".
-- =============================================================================

alter table public.time_entries
  add column if not exists task_key text;

comment on column public.time_entries.task_key is
  'Key legible de Zoho (task.key, ej. "PP1-T1"). SOLO display; NO es llave de join (esa es task_number). NULL = sin resolver → el front muestra "—". Lo puebla la edge function sync-task-keys.';
