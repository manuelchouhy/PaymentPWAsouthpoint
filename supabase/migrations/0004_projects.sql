-- =============================================================================
-- Migración FR-07 · Projects & Contracts (contratos del lado del cliente)
-- =============================================================================
-- Cómo correrlo: Supabase → SQL Editor → pegar y ejecutar.
-- =============================================================================

create table if not exists public.projects (
  id                        bigint generated always as identity primary key,
  client                    text not null,
  project_name              text not null,
  project_number            text not null unique,
  customer_name             text,
  customer_code             text,
  proposal_name             text,
  proposal_number           text,
  approver                  text,         -- customer-side approver
  customer_manager          text,
  lead_developer            text,
  contract_number           text not null,
  contract_expiration_date  date not null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  created_by                text
);

create index if not exists projects_contract_expiration_idx
  on public.projects (contract_expiration_date asc);
create index if not exists projects_client_idx on public.projects (client);


-- Auditoría de cambios (una fila por campo modificado). Se llena desde la API
-- (capturando changed_by = email del usuario logueado).
create table if not exists public.project_history (
  id           bigint generated always as identity primary key,
  project_id   bigint not null references public.projects (id) on delete cascade,
  field_name   text not null,
  old_value    text,
  new_value    text,
  changed_at   timestamptz not null default now(),
  changed_by   text
);
create index if not exists project_history_project_idx
  on public.project_history (project_id, changed_at desc);


-- Mantener updated_at al día en cada UPDATE.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();


-- ── RLS: authenticated lee/inserta/edita; nadie borra (se conserva historial) ──
alter table public.projects        enable row level security;
alter table public.project_history enable row level security;

drop policy if exists "auth read projects" on public.projects;
create policy "auth read projects" on public.projects
  for select to authenticated using (true);

drop policy if exists "auth insert projects" on public.projects;
create policy "auth insert projects" on public.projects
  for insert to authenticated with check (true);

drop policy if exists "auth update projects" on public.projects;
create policy "auth update projects" on public.projects
  for update to authenticated using (true) with check (true);

drop policy if exists "auth read project_history" on public.project_history;
create policy "auth read project_history" on public.project_history
  for select to authenticated using (true);

drop policy if exists "auth insert project_history" on public.project_history;
create policy "auth insert project_history" on public.project_history
  for insert to authenticated with check (true);
