-- =============================================================================
-- Fase 4a de la entrega Clients/Projects-SOW/Entries-Billing (reunión 2026-08-05)
-- =============================================================================
-- Schema para el wizard de Projects and SOW: Identificación, Alcance,
-- Mantenimiento (opcional), Tasks del SOW (opcional), + versionado de
-- documentos (MSA/SOW/CR) que alimenta la sección de detalle del proyecto.
-- =============================================================================

alter table public.projects
  add column if not exists sow_number text,
  add column if not exists sow_url text,
  add column if not exists has_stages boolean not null default false,
  add column if not exists stage_name text,
  add column if not exists model text not null default 'Time & Materials',
  add column if not exists period_start date,
  add column if not exists period_end date,
  add column if not exists maintenance_enabled boolean not null default false,
  add column if not exists sla_template text check (sla_template in ('Standard', 'Premium', 'Custom')),
  add column if not exists maintenance_transition text check (maintenance_transition in ('30_days', '60_days')),
  add column if not exists maintenance_hours_pool numeric,
  add column if not exists maintenance_duration_months numeric,
  add column if not exists maintenance_sla_tiers jsonb;

comment on column public.projects.model is
  'Fijo en "Time & Materials" por ahora (único modelo que contempla el template de SOW). Queda como texto para no bloquear si aparece otro modelo.';
comment on column public.projects.maintenance_sla_tiers is
  'Solo se usa con sla_template = Custom. Standard/Premium se resuelven en la app a partir de una plantilla fija, no se guardan acá.';


create table if not exists public.project_tasks (
  id                bigint generated always as identity primary key,
  project_id        bigint not null references public.projects (id) on delete cascade,
  task_name         text not null,
  role              text,
  estimated_hours   numeric not null check (estimated_hours >= 0),
  created_at        timestamptz not null default now(),
  created_by        text
);

create index if not exists project_tasks_project_id_idx on public.project_tasks (project_id);

comment on table public.project_tasks is
  'Tasks del SOW (nombre, rol, horas estimadas). Reales y desvío se calculan en runtime contra time_entries, no se guardan acá — no tiene sentido pedirlas al crear la task porque todavía no se ejecutó.';


create table if not exists public.project_documents (
  id            bigint generated always as identity primary key,
  subject_type  text not null check (subject_type in ('msa', 'sow', 'change_request')),
  subject_id    bigint not null,
  file_url      text not null,
  version       integer not null default 1,
  uploaded_at   timestamptz not null default now(),
  uploaded_by   text
);

create index if not exists project_documents_subject_idx
  on public.project_documents (subject_type, subject_id, version desc);

comment on table public.project_documents is
  'Historial versionado de PDFs firmados (MSA/SOW/CR). subject_id apunta a clients.id (msa), projects.id (sow) o change_requests.id (change_request). El "actual" sigue siendo clients.msa_url / projects.sow_url — esta tabla es el historial, nunca se borran versiones anteriores.';


alter table public.project_tasks     enable row level security;
alter table public.project_documents enable row level security;

drop policy if exists "auth read project_tasks" on public.project_tasks;
create policy "auth read project_tasks" on public.project_tasks
  for select to authenticated using (true);
drop policy if exists "auth insert project_tasks" on public.project_tasks;
create policy "auth insert project_tasks" on public.project_tasks
  for insert to authenticated with check (true);

drop policy if exists "auth read project_documents" on public.project_documents;
create policy "auth read project_documents" on public.project_documents
  for select to authenticated using (true);
drop policy if exists "auth insert project_documents" on public.project_documents;
create policy "auth insert project_documents" on public.project_documents
  for insert to authenticated with check (true);
