-- Pagos de overage: horas de overage que se le pagan al contractor SIN pasar por
-- una factura al cliente (el overage no se le cobra al cliente; es tiempo trabajado
-- que igual se le paga al proveedor).
--
-- Hoy un pago siempre cuelga de una factura (invoice_id) y el contractor sale de
-- esa factura. Un pago de overage no tiene factura, así que:
--   - entry_ids: qué horas cubre el pago (mismo mecanismo que invoices.entry_ids,
--     bigint[]), para no pagarlas dos veces y para congelarlas (entryFreeze).
--   - user_name: a quién se le pagó (invoices ya lo tiene; el pago de overage no
--     puede derivarlo de una factura inexistente).
-- invoice_id ya es nullable, así que un pago de overage va con invoice_id NULL.
alter table public.payments
  add column if not exists entry_ids bigint[],
  add column if not exists user_name text;

comment on column public.payments.entry_ids is
  'Horas (time_entries.id) que cubre un pago de overage (invoice_id NULL). Para pagos por factura queda NULL: las horas salen de la factura.';
comment on column public.payments.user_name is
  'Contractor al que se le pagó, para pagos de overage sin factura. Para pagos por factura queda NULL (el contractor sale de la factura).';
