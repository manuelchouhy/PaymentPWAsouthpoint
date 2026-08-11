-- =============================================================================
-- Fase 2 de la entrega Clients/Projects-SOW/Entries-Billing (reunión 2026-08-05)
-- =============================================================================
-- Asignaciones: horas autorizadas por proveedor y task dentro de un proyecto,
-- definidas por el PM. Entries (Fase 5) usa esto para autoclasificar el
-- allocation de una hora: dentro de la autorización → bill_to_client, por
-- encima → overage. La UI vive dentro de Projects and SOW (Fase 4) — esta
-- migración solo deja la tabla lista.
-- =============================================================================

create table if not exists public.provider_assignments (
  id                bigint generated always as identity primary key,
  project_id        bigint not null references public.projects (id) on delete cascade,
  task_name         text not null,
  provider_name     text not null,
  authorized_hours  numeric not null check (authorized_hours >= 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        text
);

create unique index if not exists provider_assignments_unique_idx
  on public.provider_assignments (project_id, task_name, provider_name);
create index if not exists provider_assignments_project_id_idx
  on public.provider_assignments (project_id);

drop trigger if exists provider_assignments_set_updated_at on public.provider_assignments;
create trigger provider_assignments_set_updated_at
  before update on public.provider_assignments
  for each row execute function public.set_updated_at();

alter table public.provider_assignments enable row level security;

drop policy if exists "auth read provider_assignments" on public.provider_assignments;
create policy "auth read provider_assignments" on public.provider_assignments
  for select to authenticated using (true);
drop policy if exists "auth insert provider_assignments" on public.provider_assignments;
create policy "auth insert provider_assignments" on public.provider_assignments
  for insert to authenticated with check (true);
drop policy if exists "auth update provider_assignments" on public.provider_assignments;
create policy "auth update provider_assignments" on public.provider_assignments
  for update to authenticated using (true) with check (true);

comment on table public.provider_assignments is
  'Horas autorizadas por proveedor y task en un proyecto (definidas por el PM). Consumida/restante se calculan en runtime contra time_entries, no se guardan acá.';
