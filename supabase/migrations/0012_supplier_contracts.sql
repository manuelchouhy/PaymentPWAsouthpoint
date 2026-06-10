-- =============================================================================
-- FR-14 · Supplier Contracts (contratos del lado del proveedor)
-- =============================================================================
-- Distinto de Projects & Contracts (FR-07, lado cliente). Acá se registran los
-- contratos con proveedores (contractors), con southpointlabs como prioritario.
-- =============================================================================

create table if not exists public.supplier_contracts (
  id                   bigint generated always as identity primary key,
  supplier_name        text not null,
  is_priority_supplier boolean not null default false,
  contract_number      text not null unique,
  start_date           date not null,
  expiration_date      date not null,
  renewal_date         date not null,
  payment_terms        text not null
                         check (payment_terms in ('Net 15', 'Net 30', 'Net 45')),
  renewal_type         text not null default 'Auto-notify'
                         check (renewal_type in ('Manual', 'Auto-notify')),
  status               text not null default 'Active'
                         check (status in ('Active', 'Renewal in Progress', 'Expiring Soon', 'Critical', 'Expired')),
  pdf_url              text,
  archived             boolean not null default false,
  parent_contract_id   bigint references public.supplier_contracts (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           text
);

create index if not exists supplier_contracts_expiration_idx on public.supplier_contracts (expiration_date asc);
create index if not exists supplier_contracts_supplier_idx   on public.supplier_contracts (supplier_name);
create index if not exists supplier_contracts_priority_idx   on public.supplier_contracts (is_priority_supplier);


-- Auditoría de cambios (una fila por campo modificado).
create table if not exists public.supplier_contract_history (
  id           bigint generated always as identity primary key,
  contract_id  bigint not null references public.supplier_contracts (id) on delete cascade,
  field_name   text not null,
  old_value    text,
  new_value    text,
  changed_at   timestamptz not null default now(),
  changed_by   text
);
create index if not exists supplier_contract_history_idx
  on public.supplier_contract_history (contract_id, changed_at desc);


-- updated_at automático (reusa la función creada en 0004).
drop trigger if exists supplier_contracts_set_updated_at on public.supplier_contracts;
create trigger supplier_contracts_set_updated_at
  before update on public.supplier_contracts
  for each row execute function public.set_updated_at();


-- ── RLS: authenticated lee/inserta/edita; nadie borra ────────────────────────
alter table public.supplier_contracts         enable row level security;
alter table public.supplier_contract_history  enable row level security;

drop policy if exists "auth read supplier_contracts" on public.supplier_contracts;
create policy "auth read supplier_contracts" on public.supplier_contracts
  for select to authenticated using (true);
drop policy if exists "auth insert supplier_contracts" on public.supplier_contracts;
create policy "auth insert supplier_contracts" on public.supplier_contracts
  for insert to authenticated with check (true);
drop policy if exists "auth update supplier_contracts" on public.supplier_contracts;
create policy "auth update supplier_contracts" on public.supplier_contracts
  for update to authenticated using (true) with check (true);

drop policy if exists "auth read supplier_contract_history" on public.supplier_contract_history;
create policy "auth read supplier_contract_history" on public.supplier_contract_history
  for select to authenticated using (true);
drop policy if exists "auth insert supplier_contract_history" on public.supplier_contract_history;
create policy "auth insert supplier_contract_history" on public.supplier_contract_history
  for insert to authenticated with check (true);
