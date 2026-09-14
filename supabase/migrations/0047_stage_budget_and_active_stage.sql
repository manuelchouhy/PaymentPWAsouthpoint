-- =============================================================================
-- Budget por stage + stage activo (2026-09-14)
-- =============================================================================
-- Habilita asignarle un budget (horas) a cada stage interno de un proyecto y
-- marcar cuál stage está ACTIVO. El budget vigente del proyecto pasa a ser el del
-- stage activo (ver src/lib/projectStageBudget.js); el total es la suma de los
-- budgets de sus stages. Un proyecto sin stages sigue usando base_budget_hours.
--
-- Dos columnas, ambas nullable, no destructivo e idempotente:
--   * project_stages.budget_hours : budget del stage (null = sin cargar; 0 válido).
--   * projects.active_stage_id     : stage marcado activo (FK; ON DELETE SET NULL
--                                    para no romper si algún día se borra el stage).
--
-- RLS: project_stages ya tiene update (0025) → cubre budget_hours; projects ya
-- tiene update → cubre active_stage_id. No se agregan policies nuevas ni delete.
-- =============================================================================

alter table public.project_stages
  add column if not exists budget_hours numeric;

alter table public.projects
  add column if not exists active_stage_id bigint
    references public.project_stages(id) on delete set null;
