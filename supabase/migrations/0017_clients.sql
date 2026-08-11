-- =============================================================================
-- Clients · alta de clientes (reunión de requerimientos 2026-08-05)
-- =============================================================================
-- Módulo nuevo: cada cliente se crea una vez acá, con su MSA (Master Service
-- Agreement) adjunto. El módulo Projects and SO autopopula el MSA a partir del
-- cliente elegido — no se vuelve a subir ahí.
-- =============================================================================

create table if not exists public.clients (
  id                     bigint generated always as identity primary key,
  client_name            text not null,
  email                  text,
  domain                 text,
  primary_contact_name   text not null,
  primary_contact_email  text not null,
  msa_url                text not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             text
);

create index if not exists clients_client_name_idx on public.clients (client_name);

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();


-- ── RLS: authenticated lee/inserta/edita; nadie borra ────────────────────────
alter table public.clients enable row level security;

drop policy if exists "auth read clients" on public.clients;
create policy "auth read clients" on public.clients
  for select to authenticated using (true);
drop policy if exists "auth insert clients" on public.clients;
create policy "auth insert clients" on public.clients
  for insert to authenticated with check (true);
drop policy if exists "auth update clients" on public.clients;
create policy "auth update clients" on public.clients
  for update to authenticated using (true) with check (true);


-- ── Storage bucket 'client-msa' (MSA firmado, PDF) ───────────────────────────
insert into storage.buckets (id, name, public)
values ('client-msa', 'client-msa', false)
on conflict (id) do nothing;

drop policy if exists "auth upload client-msa" on storage.objects;
create policy "auth upload client-msa" on storage.objects
  for insert to authenticated with check (bucket_id = 'client-msa');

drop policy if exists "auth read client-msa" on storage.objects;
create policy "auth read client-msa" on storage.objects
  for select to authenticated using (bucket_id = 'client-msa');
