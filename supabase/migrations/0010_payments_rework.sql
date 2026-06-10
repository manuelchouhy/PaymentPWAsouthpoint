-- =============================================================================
-- FR-10 · Payments al contractor (rework de la tabla payments)
-- =============================================================================
-- Un payment es un pago al contractor, vinculado a una invoice ya 'Collected'.
-- Se borran las 2 filas viejas del prototipo y se realinea el esquema.
-- =============================================================================

-- Borrar las 2 filas viejas (mock del prototipo, no son pagos reales).
delete from public.payments;

-- Sacar columnas del modelo viejo.
alter table public.payments
  drop column if exists user_name,
  drop column if exists total_hours,
  drop column if exists invoice_number,
  drop column if exists transaction_number,
  drop column if exists entry_ids;

-- Nuevo modelo.
alter table public.payments
  add column if not exists invoice_id          bigint references public.invoices (id),
  add column if not exists amount_paid          numeric(12, 2) not null,
  add column if not exists payment_date         date not null,
  add column if not exists transfer_reference   text,
  add column if not exists bank_method          text,
  add column if not exists notes                text,
  add column if not exists created_by           text,
  add column if not exists back_dated           boolean not null default false;

create index if not exists payments_invoice_idx on public.payments (invoice_id);

-- RLS: las policies de payments (read/insert authenticated) ya existen.
