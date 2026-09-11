-- =============================================================================
-- Projects & SOW (2026-09-11) — vincular cada task del SOW a un stage (opcional)
-- =============================================================================
-- Agrega project_tasks.stage_id: a qué stage del proyecto pertenece la task. Es
-- OPCIONAL (nullable) — una task sin stage queda "sin asignar". FK a project_stages
-- con ON DELETE SET NULL: si algún día se borra un stage, sus tasks quedan sin
-- asignar en vez de romper la FK. No destructivo e idempotente.
-- =============================================================================

alter table public.project_tasks
  add column if not exists stage_id bigint
    references public.project_stages(id) on delete set null;

create index if not exists idx_project_tasks_stage_id
  on public.project_tasks(stage_id);
