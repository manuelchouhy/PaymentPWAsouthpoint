-- =============================================================================
-- Negative-cache del código corto: columna `task_key_checked_at` (2026-09-16)
-- =============================================================================
-- DRAFT / GATED — NO aplicar sin aprobación humana explícita. No destructivo,
-- idempotente (solo ADD COLUMN).
--
-- Feature task-key-display (slice 04). La edge function sync-task-keys pide a Zoho el
-- código corto de cada task_number sin key. Los que NUNCA resuelven (task borrada en
-- Zoho, o task con key null) se re-pedían en CADA corrida → churn, y por el orden fijo de
-- proyectos, starvation de proyectos de id alto.
--
--   * time_entries.task_key_checked_at : timestamp de la última vez que se chequeó ESTE
--     task_number contra Zoho y NO se encontró key (respuesta definitiva: 200 con key null,
--     o 4xx/404). sync-task-keys lo usa como negative-cache: no re-pide un task_number sin
--     key cuyo checked_at es reciente (cooldown), pero SÍ lo reintenta cuando el cooldown
--     vence (recupera keys asignadas tarde en Zoho). NULL = nunca chequeado (se intenta).
--
-- No afecta a task_key (display) ni al join (task_number). Cuando la key se resuelve,
-- task_key deja de ser NULL y este campo se vuelve irrelevante (el filtro del sync es por
-- task_key IS NULL).
-- =============================================================================

alter table public.time_entries
  add column if not exists task_key_checked_at timestamptz;

comment on column public.time_entries.task_key_checked_at is
  'Negative-cache de sync-task-keys: última vez que se chequeó este task_number contra Zoho sin encontrar key (respuesta definitiva). Evita re-pedir cada corrida los irresolubles; se reintenta al vencer el cooldown. NULL = nunca chequeado.';

-- Índice PARCIAL para la query hot de sync-task-keys (missingTaskNumbers): por proyecto, filas
-- SIN key filtrando por task_key_checked_at. El parcial (where task_key is null) mantiene el
-- índice chico —solo las filas aún sin resolver— y cubre el filtro (zoho_project_id, checked_at).
create index if not exists idx_time_entries_task_key_pending
  on public.time_entries (zoho_project_id, task_key_checked_at)
  where task_key is null;
