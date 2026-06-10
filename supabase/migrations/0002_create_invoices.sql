-- =============================================================================
-- Migración FR-05 · tabla `invoices` (emisión de facturas, etapa previa al pago)
-- =============================================================================
-- El flujo nuevo separa: Facturar (Billing) → Cobrar (Collections) → Pagar al
-- contractor (Payment). Esta tabla cubre la EMISIÓN de la factura.
--
-- La tabla `payments` se mantiene pero pasa a representar "pagos al contractor"
-- (FR-10); este flujo ya no inserta ahí.
--
-- Cómo correrlo: Supabase → SQL Editor → pegar y ejecutar.
-- =============================================================================

create table if not exists public.invoices (
  id                       bigint generated always as identity primary key,
  supplier_invoice_number  text not null,
  invoice_date             date not null,
  total_amount             numeric(12, 2) not null,
  notes                    text,
  user_name                text not null,          -- contractor
  entry_ids                bigint[] not null,       -- time entries incluidas
  status                   text not null default 'Invoiced',  -- luego: Collected, Paid
  created_at               timestamptz not null default now(),
  created_by               text                     -- email del usuario logueado
);

create index if not exists invoices_user_name_idx  on public.invoices (user_name);
create index if not exists invoices_status_idx     on public.invoices (status);
create index if not exists invoices_created_at_idx on public.invoices (created_at desc);

-- RLS: habilitado. Descomentá en schema.sql la política (anon/authenticated)
-- que corresponda a cómo accede tu app.
alter table public.invoices enable row level security;
