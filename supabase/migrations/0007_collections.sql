-- =============================================================================
-- FR-09 · Collections (cobros de facturas emitidas al cliente)
-- =============================================================================
-- Una factura puede tener varios cobros (cobros parciales). El Collection Status
-- se calcula como SUM(amount_received) vs invoices.total_amount.
-- Cuando una factura queda 'Collected' (full), la app actualiza invoices.status
-- a 'Collected' y registra la transición en invoice_status_history.
-- =============================================================================

create table if not exists public.collections (
  id               bigint generated always as identity primary key,
  invoice_id       bigint not null references public.invoices (id) on delete cascade,
  amount_received  numeric(12, 2) not null,
  collection_date  date not null,
  bank_reference   text,
  voucher_url      text,                 -- para upload futuro (hoy null)
  notes            text,
  created_at       timestamptz not null default now(),
  created_by       text
);

create index if not exists collections_invoice_idx on public.collections (invoice_id);
create index if not exists collections_date_idx    on public.collections (collection_date desc);

-- Vista de conveniencia: sumas cobradas por factura (opcional para queries).
create or replace view public.invoice_collection_totals as
  select
    i.id                                   as invoice_id,
    i.total_amount,
    coalesce(sum(c.amount_received), 0)     as amount_collected,
    i.total_amount - coalesce(sum(c.amount_received), 0) as outstanding
  from public.invoices i
  left join public.collections c on c.invoice_id = i.id
  group by i.id, i.total_amount;

-- ── RLS: authenticated lee e inserta cobros ──────────────────────────────────
alter table public.collections enable row level security;

drop policy if exists "auth read collections" on public.collections;
create policy "auth read collections" on public.collections
  for select to authenticated using (true);

drop policy if exists "auth insert collections" on public.collections;
create policy "auth insert collections" on public.collections
  for insert to authenticated with check (true);
