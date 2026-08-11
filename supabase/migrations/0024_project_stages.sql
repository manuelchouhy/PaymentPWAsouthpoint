-- =============================================================================
-- Fase 4d de la entrega Clients/Projects-SOW/Entries-Billing
-- =============================================================================
-- Extiende el modelo de stages: en vez de un solo stage_name de texto en
-- `projects` (Fase 4a), un proyecto con has_stages=true ahora puede tener
-- varios stages, cada uno con su propio SOW (número + archivo) — jerarquía
-- Cliente → Proyecto → Stages → cada Stage tiene un SOW, como quedó acordado
-- en la reunión de requerimientos original.
--
-- projects.stage_name/sow_number/sow_url quedan como están (nullable, sin
-- tocar) para no romper los proyectos ya creados en Fase 4a-4c: siguen
-- siendo la fuente de verdad cuando has_stages=false. Cuando has_stages=true,
-- esas columnas del proyecto quedan en null y el SOW vive en project_stages.
-- =============================================================================

create table if not exists public.project_stages (
  id          bigint generated always as identity primary key,
  project_id  bigint not null references public.projects (id) on delete cascade,
  position    integer not null default 0,
  stage_name  text not null,
  sow_number  text not null,
  sow_url     text,
  created_at  timestamptz not null default now(),
  created_by  text
);

create index if not exists project_stages_project_id_idx
  on public.project_stages (project_id, position);

comment on table public.project_stages is
  'Stages de un proyecto con has_stages=true. Cada stage tiene su propio SOW (número + archivo) — reemplaza el stage_name único de Fase 4a para proyectos que necesitan más de un stage.';

alter table public.project_stages enable row level security;

drop policy if exists "auth read project_stages" on public.project_stages;
create policy "auth read project_stages" on public.project_stages
  for select to authenticated using (true);
drop policy if exists "auth insert project_stages" on public.project_stages;
create policy "auth insert project_stages" on public.project_stages
  for insert to authenticated with check (true);
