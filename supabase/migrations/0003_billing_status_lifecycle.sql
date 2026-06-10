-- =============================================================================
-- Migración FR · Billing Status de 4 estados (Pending → Invoiced → Collected → Paid)
-- =============================================================================
-- El estado "Pending" es la AUSENCIA de factura (la time_entry no está en
-- ninguna invoice). La columna invoices.status sólo toma los otros 3 valores.
--
-- Cómo correrlo: Supabase → SQL Editor → pegar y ejecutar.
-- =============================================================================

-- 1) CHECK con los valores válidos de invoices.status.
alter table public.invoices
  drop constraint if exists invoices_status_check;
alter table public.invoices
  add constraint invoices_status_check
  check (status in ('Invoiced', 'Collected', 'Paid'));


-- 2) Historial de cambios de estado (auditoría) — alimenta el detalle de factura.
create table if not exists public.invoice_status_history (
  id           bigint generated always as identity primary key,
  invoice_id   bigint not null references public.invoices (id) on delete cascade,
  from_status  text,
  to_status    text not null,
  changed_at   timestamptz not null default now(),
  changed_by   text,
  note         text
);

create index if not exists invoice_status_history_invoice_idx
  on public.invoice_status_history (invoice_id, changed_at desc);

alter table public.invoice_status_history enable row level security;
