-- =============================================================================
-- FR-15 · Supplier Contracts: snooze de "Renewal in Progress" + Storage
-- =============================================================================

-- Snooze: silencia las alertas por un período; al pasar, vuelve al estado previo.
alter table public.supplier_contracts
  add column if not exists snooze_until    timestamptz,
  add column if not exists previous_status text;


-- ── Storage bucket 'supplier-contracts' (PDFs de contratos) ──────────────────
-- authenticated puede subir, leer y listar; NADIE puede borrar (se conserva).
insert into storage.buckets (id, name, public)
values ('supplier-contracts', 'supplier-contracts', false)
on conflict (id) do nothing;

drop policy if exists "auth upload supplier-contracts" on storage.objects;
create policy "auth upload supplier-contracts" on storage.objects
  for insert to authenticated with check (bucket_id = 'supplier-contracts');

drop policy if exists "auth read supplier-contracts" on storage.objects;
create policy "auth read supplier-contracts" on storage.objects
  for select to authenticated using (bucket_id = 'supplier-contracts');

-- (no creamos policy de delete → nadie puede borrar archivos)
