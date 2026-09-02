-- 0041 — DROP de las columnas de plata/moneda de Billing y Payments (modelo en horas).
--
-- ⚠️⚠️ DRAFT / NO APLICADO — DESTRUCTIVO E IRREVERSIBLE. Escrita por el agente
-- (slice 04c) para revisión humana. Borra columnas con datos. NO correr sin:
--   (1) 0040 aplicada (reescribe register_contractor_payment sin amount_paid/etc.),
--   (2) que la app (slice 04d) haya dejado de leer/escribir estas columnas:
--       - createInvoice viejo (single-contractor, BillModal de Time Entries) setea
--         total_amount/currency → hay que migrarlo primero o su INSERT fallará.
--       - paymentsData/invoicelessPaidRows leen amountPaid/currency → migrar la UI.
--       - ⚠️ EDGE FUNCTIONS DEPLOYADAS (superficie aparte del frontend):
--           supabase/functions/payment-alerts/index.ts   (select+uso de total_amount)
--           supabase/functions/collection-alerts/index.ts (idem)
--         Tras el drop, PostgREST devuelve "column invoices.total_amount does not
--         exist" y esas funciones fallan (las alertas de vencimiento dejan de salir).
--         Hay que redeployarlas SIN total_amount ANTES de aplicar esta migración.
--   (3) backup / snapshot de invoices y payments (esto no se puede deshacer).
--
-- Columnas que se dropean:
--   invoices: total_amount, currency
--   payments: amount_paid, currency, exchange_rate
--
-- Objetos que DEPENDEN de esas columnas (hay que tratarlos ANTES del drop, o el
-- drop falla con 2BP01 "cannot drop ... because other objects depend on it"):
--   - view invoice_collection_totals  → usa invoices.total_amount. Collections no se
--     usa (Billing va directo a Payments), así que se DROPEA sin recrear.
--   - view trace_view → usa total_amount/currency/amount_paid. Se DROPEA y se RECREA
--     sin esas columnas (el resto de la traza se conserva).
--   - function register_contractor_payment (versión vieja con amount_paid/etc.): ya
--     la dropeó 0040. Si por orden de aplicación no estuviera, correr 0040 primero.

begin;

-- 1) Vistas dependientes fuera del camino.
--    Collections no se usa: la vista de totales de cobro se dropea y no se recrea.
drop view if exists public.invoice_collection_totals;

--    trace_view: se dropea para recrearla sin las columnas de plata (CREATE OR REPLACE
--    VIEW no permite QUITAR columnas, sólo agregar al final, así que hay que DROP+CREATE).
drop view if exists public.trace_view;

-- 2) DROP de las columnas de plata.
alter table public.invoices
  drop column if exists total_amount,
  drop column if exists currency;

alter table public.payments
  drop column if exists amount_paid,
  drop column if exists currency,
  drop column if exists exchange_rate;

-- 3) Recrea trace_view SIN las 3 columnas de plata (invoice_amount, invoice_currency,
--    amount_paid). Se conserva TODO lo demás, incluida la agregación de collections
--    (no depende de las columnas dropeadas). Se agrega sp_invoice_number (identidad de
--    la factura agrupada, que suele dejar supplier_invoice_number NULL) y paid_contractor
--    (p.user_name), útil ahora que hay un pago por contractor.
--    ⚠️ NOTA (04d) — DOBLE-CONTEO: con el pago por-contractor una factura tiene VARIOS
--    pagos, así que `left join payments` hace fan-out a N filas por time entry (una por
--    contractor pagado). Las columnas de invoice y las de collections (collected_amount,
--    collection_count, del subquery ca) se REPITEN en esas N filas: cualquier consumidor
--    que SUME/CUENTE esas columnas por factura sobre trace_view las multiplicaría por N.
--    Hoy Collections no se usa (bajo riesgo), pero si trace_view va a alimentar agregados
--    hay que reestructurarla en 04d (separar el grano de pago del de factura/cobro).
create or replace view public.trace_view
  with (security_invoker = true)
as
  select
    -- Time Entry
    te.id                                       as time_entry_id,
    te.zoho_log_id,
    te.user_name,
    te.log_date,
    te.hours,
    te.client,
    te.project,
    te.task,
    te.description,
    te.status                                   as zoho_status,
    te.synced_at,
    -- Invoice (sin monto/moneda: el modelo es en horas)
    i.id                                        as invoice_id,
    i.supplier_invoice_number,
    i.sp_invoice_number,
    i.invoice_date,
    i.status                                    as invoice_status,
    i.payment_terms_days,
    i.created_at                                as invoiced_at,
    i.created_by                                as invoiced_by,
    -- Collections (agregadas) — se conservan (no dependen de las columnas dropeadas)
    coalesce(ca.amount_collected, 0)            as collected_amount,
    ca.last_collection_date,
    coalesce(ca.collection_count, 0)            as collection_count,
    -- Payment al contractor (sin monto)
    p.id                                        as payment_id,
    p.user_name                                 as paid_contractor,
    p.payment_date,
    p.transfer_reference,
    p.bank_method,
    p.notes                                     as payment_notes,
    p.created_at                                as paid_at,
    p.created_by                                as paid_by
  from public.time_entries te
  left join public.invoices i
    on i.entry_ids @> array[te.id]
  left join (
    select
      invoice_id,
      sum(amount_received)  as amount_collected,
      max(collection_date)  as last_collection_date,
      count(*)              as collection_count
    from public.collections
    group by invoice_id
  ) ca on ca.invoice_id = i.id
  left join public.payments p on p.invoice_id = i.id;

commit;
