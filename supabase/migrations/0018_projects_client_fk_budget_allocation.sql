-- =============================================================================
-- Fase 1 de la entrega Clients/Projects-SOW/Entries-Billing (reunión 2026-08-05)
-- =============================================================================
-- Piezas de datos que las pantallas nuevas (Client Summary, Entries) necesitan
-- para mostrar números reales en vez de columnas vacías:
--   · projects.client_id → FK real a clients (además del texto libre `client`,
--     que se conserva para no romper el sync de Zoho ni las pantallas actuales).
--   · projects.base_budget_hours + change_requests → el presupuesto de horas
--     "vigente" de un proyecto es una pila: base + change requests aprobados
--     de tipo expand_budget. Lo consume el cálculo de Client Summary.
--   · time_entries.allocation → bill_to_client / overage / sp_internal. Nulo =
--     todavía no triageada (Entries las tiene que listar primero).
-- =============================================================================

alter table public.projects
  add column if not exists client_id bigint references public.clients (id) on delete set null,
  add column if not exists base_budget_hours numeric;

create index if not exists projects_client_id_idx on public.projects (client_id);

comment on column public.projects.client_id is
  'FK real al cliente (tabla clients). client (texto libre) se conserva para el sync de Zoho.';
comment on column public.projects.base_budget_hours is
  'Presupuesto de horas original del SOW. El vigente = base_budget_hours + suma de change_requests aprobados de tipo expand_budget.';


create table if not exists public.change_requests (
  id            bigint generated always as identity primary key,
  project_id    bigint not null references public.projects (id) on delete cascade,
  cr_number     text not null,
  type          text not null check (type in ('expand_budget', 'write_off_overage', 'other')),
  delta_hours   numeric not null,
  reason        text,
  requested_by  text,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by    text,
  decided_at    timestamptz,
  created_at    timestamptz not null default now(),
  created_by    text
);

create unique index if not exists change_requests_project_cr_number_idx
  on public.change_requests (project_id, cr_number);
create index if not exists change_requests_project_id_idx
  on public.change_requests (project_id);

alter table public.change_requests enable row level security;

drop policy if exists "auth read change_requests" on public.change_requests;
create policy "auth read change_requests" on public.change_requests
  for select to authenticated using (true);
drop policy if exists "auth insert change_requests" on public.change_requests;
create policy "auth insert change_requests" on public.change_requests
  for insert to authenticated with check (true);
drop policy if exists "auth update change_requests" on public.change_requests;
create policy "auth update change_requests" on public.change_requests
  for update to authenticated using (true) with check (true);


alter table public.time_entries
  add column if not exists allocation text check (allocation in ('bill_to_client', 'overage', 'sp_internal'));

create index if not exists time_entries_allocation_idx on public.time_entries (allocation);

comment on column public.time_entries.allocation is
  'Triage de Entries: bill_to_client (factura al cliente) / overage (lo asumimos, requiere CR) / sp_internal (interno, nunca se factura). Nulo = todavía sin triagear — Entries tiene que listar estas primero.';
