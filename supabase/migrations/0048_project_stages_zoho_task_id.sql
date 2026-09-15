-- =============================================================================
-- Stages desde Zoho: ancla `zoho_task_id` en project_stages (2026-09-14)
-- =============================================================================
-- DRAFT / GATED — NO aplicar sin aprobación humana explícita. No destructivo,
-- idempotente (solo ADD COLUMN + índice).
--
-- Un Stage de la app (project_stages) pasa a originarse en una Task "Stage N" de
-- Zoho (ver CONTEXT.md → Stage y ADR-0003). `zoho_task_id` guarda el id de esa Task
-- en Zoho: es la clave ESTABLE del sync (upsert/diff), así el budget y el stage
-- activo (datos del Desk) sobreviven un renombre en Zoho.
--
--   * project_stages.zoho_task_id : id INTERNO largo de Zoho de la Task-Stage. TEXT
--     porque los ids de Zoho son enteros grandes (fuera del rango seguro de JS) y así
--     matchea el tipo de time_entries.task_number (string). Es la clave para ASOCIAR
--     (une la hora con la task). NULL = stage manual legacy (en transición; el primer
--     sync los borra por diff, ADR-0003).
--   * project_stages.zoho_task_key : key LEGIBLE de Zoho (ej. "PP1-T5"), la que se
--     MUESTRA en el front. NO se usa para joins (ver CONTEXT.md → Task id vs Task key).
--
-- Índice único PARCIAL por (project_id, zoho_task_id) donde no es null: garantiza un
-- solo Stage por Task de Zoho por proyecto (para el upsert), sin bloquear los varios
-- stages manuales legacy con zoho_task_id null.
-- =============================================================================

alter table public.project_stages
  add column if not exists zoho_task_id text;

alter table public.project_stages
  add column if not exists zoho_task_key text;

create unique index if not exists uq_project_stages_project_zoho_task
  on public.project_stages (project_id, zoho_task_id)
  where zoho_task_id is not null;

-- Los Stages sincronizados de Zoho NO tienen SOW number (era NOT NULL por el wizard
-- legacy). Se relaja a nullable para poder insertar un stage de Zoho con sow_number null.
alter table public.project_stages
  alter column sow_number drop not null;
