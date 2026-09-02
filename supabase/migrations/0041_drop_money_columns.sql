-- 0041 — DROP de las columnas de plata/moneda de Billing y Payments (modelo en horas).
--
-- ⚠️⚠️ DRAFT / NO APLICADO — DESTRUCTIVO E IRREVERSIBLE. Escrita por el agente
-- (slice 04c) para revisión humana. Borra columnas con datos. NO correr sin:
--   (1) 0040 aplicada (reescribe register_contractor_payment sin amount_paid/etc.),
--   (2) que la app (slice 04d) haya dejado de leer/escribir estas columnas:
--       - createInvoice viejo (single-contractor, BillModal de Time Entries) setea
--         total_amount/currency → hay que migrarlo primero o su INSERT fallará.
--       - paymentsData/invoicelessPaidRows leen amountPaid/currency → migrar la UI.
--       - traceData.js (04d, la vista cambia de forma):
--           · rowToTrace lee invoice_amount/amount_paid → la vista ya no los expone
--             (van a null, sin crash; el detalle de plata en la traza queda en blanco).
--           · el supplier# de una factura AGRUPADA ahora vive en la columna nueva
--             contractor_supplier_invoice_number (i.supplier_invoice_number queda NULL);
--             hay que mapearla y buscar por ella, o la búsqueda por supplier# no
--             encuentra facturas agrupadas.
--           · searchTrace filtra `contractor` por time_entries.user_name; la vista ahora
--             expone la columna `contractor` (de invoice_contractors) para filtrar por el
--             contractor facturado, si se quiere ese criterio.
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

-- Índice GIN para el join por containment (ic.entry_ids @> array[te.id]) de la nueva
-- trace_view: 0039 sólo indexó invoice_contractors por invoice_id y payment_id. Sin
-- esto, cada time entry haría array-scan de las filas ic. (invoice_contractors es chica
-- hoy; el CREATE simple —no CONCURRENTLY— es instantáneo y va dentro de la transacción.)
create index if not exists invoice_contractors_entry_ids_gin
  on public.invoice_contractors using gin (entry_ids);

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
--    la factura agrupada, que suele dejar supplier_invoice_number NULL), paid_contractor
--    y supplier_invoice_number por-contractor.
--    El grano se mantiene UNA fila por time entry: el pago se toma vía la fila
--    invoice_contractors cuyos entry_ids contienen la hora (los entry_ids no se solapan
--    entre contractors), no con `join payments on invoice_id` —que con N pagos por
--    factura mis-atribuiría el pago de otros contractors y duplicaría las columnas de
--    invoice/collections—. Ver el detalle en los joins de abajo.
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
    -- Contractor de ESTA hora y su pago (sin monto). Ver el join por invoice_contractors
    -- abajo: el pago es el de la fila cuyo entry_ids contiene te.id. `contractor` se
    -- puebla aunque no haya cobrado (es la fila, no el pago); para saber si cobró, mirar
    -- payment_id/payment_date. `contractor_supplier_invoice_number` es el supplier# por
    -- contractor (distinto de i.supplier_invoice_number, el de la factura vieja
    -- single-contractor, que en el modelo agrupado queda NULL).
    ic.contractor                               as contractor,
    ic.supplier_invoice_number                  as contractor_supplier_invoice_number,
    p.id                                        as payment_id,
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
  -- El pago de ESTA hora, no todos los de la factura: su contractor es la fila
  -- invoice_contractors cuyos entry_ids la contienen, y su pago es el enlazado por
  -- payment_id. Así cada hora trae SU pago (sin mis-atribuir los de otros contractors)
  -- y NO hay fan-out: te.id matchea una sola fila ic, así que las columnas de
  -- invoice/collections no se duplican. Si el contractor aún no cobró, ic.payment_id es
  -- NULL y p queda NULL.
  --
  -- El "una sola fila ic por te.id" depende de que los entry_ids NO se solapen entre
  -- contractors de una misma factura. Ese invariante lo garantiza el ÚNICO writer,
  -- create_grouped_invoice (0039), alimentado por el builder JS invoiceContractors.js
  -- (que rechaza solapes cross-contractor). No hay hoy un constraint de BD que lo
  -- imponga contra un llamador directo del RPC; si se quisiera blindar, iría un
  -- exclusion/anti-overlap sobre los entry_ids desnormalizados en un follow-up (no acá:
  -- 0039 ya está en prod y no se reescribe). Con solape, te.id haría fan-out otra vez.
  left join public.invoice_contractors ic
    on ic.invoice_id = i.id and ic.entry_ids @> array[te.id]
  -- Pago de la hora. Nuevo modelo: el enlazado por ic.payment_id (por contractor).
  -- Facturas LEGACY single-contractor (pagadas por el flujo viejo) NO tienen fila ic;
  -- su pago cuelga por invoice_id. La rama `ic.id is null and p.invoice_id = i.id`
  -- rescata ese caso SIN reintroducir fan-out: se activa sólo cuando no hubo match de
  -- ic (legacy), no en una factura agrupada —cuyas horas siempre están en alguna fila
  -- ic, porque invoices.entry_ids es la unión de las ic (0039)—, así que ésta nunca
  -- junta todos sus pagos por invoice_id. Legacy tenía un solo pago por factura.
  left join public.payments p
    on p.id = ic.payment_id
    or (ic.id is null and p.invoice_id = i.id);

commit;
