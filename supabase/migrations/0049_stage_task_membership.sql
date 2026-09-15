-- 0049 — DRAFT (NO aplicada todavía; requiere aprobación humana antes de correr).
-- Membresía subtask→stage para atribuir HORAS por stage (slice 02 de stages-from-zoho).
--
-- Contexto: un Stage es una Task top-level de Zoho ("Stage N", ver sync-project-stages).
-- Sus SUBTASKS son las tasks reales contra las que se cargan horas (time_entries.taskNumber
-- = zoho task id). Esta tabla guarda, por cada subtask, a qué stage pertenece, para que el
-- front arme el mapa taskToStage (zoho_task_id → stage_id) y reparta el consumo por stage
-- (ver src/lib/stageHourAttribution.js: buildTaskToStage + attributeHoursByStage).
--
-- La puebla la edge function `sync-stage-task-membership` (service role, bypass RLS). El
-- front sólo LEE (arma el mapa). Clave por (project_id, zoho_task_id): un subtask pertenece
-- a un solo stage dentro de un proyecto.

-- Target de la FK compuesta de abajo: project_stages.id ya es PK (único), pero para
-- referenciar (project_id, id) juntos hace falta un UNIQUE sobre ese par.
alter table public.project_stages
  add constraint project_stages_project_id_id_key unique (project_id, id);

create table if not exists public.stage_task_membership (
  project_id   bigint      not null,
  stage_id     bigint      not null,
  zoho_task_id text        not null,
  task_name    text,
  updated_at   timestamptz not null default now(),
  primary key (project_id, zoho_task_id),
  constraint fk_membership_project
    foreign key (project_id) references public.projects(id) on delete cascade,
  -- FK COMPUESTA: garantiza a nivel DB que el stage pertenece a ESTE proyecto (no se puede
  -- insertar una membresía con un stage de otro proyecto). ON DELETE CASCADE: si el stage
  -- se borra (o cambia de proyecto), su membresía se limpia.
  constraint fk_membership_stage
    foreign key (project_id, stage_id) references public.project_stages(project_id, id) on delete cascade
);

create index if not exists idx_stage_task_membership_stage
  on public.stage_task_membership(stage_id);
create index if not exists idx_stage_task_membership_project
  on public.stage_task_membership(project_id);

alter table public.stage_task_membership enable row level security;

-- Igual criterio que project_stages: authenticated puede LEER (el front arma taskToStage).
-- Las escrituras (upsert/reconcile) las hace la edge function con service role, que hace
-- bypass de RLS, así que acá NO se agregan policies de insert/update/delete para authenticated.
create policy "auth read stage_task_membership"
  on public.stage_task_membership
  for select
  to authenticated
  using (true);
