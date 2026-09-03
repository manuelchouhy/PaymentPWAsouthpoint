-- 0042 — trace_view por CONTRACTOR (modelo agrupado en horas). Contraparte de app de
-- slice 04d: acompaña la reescritura de traceData.js.
--
-- ⚠️ DRAFT / NO APLICADO. Escrita por el agente (slice 04d) para revisión humana.
-- Depende de 0039 (invoice_contractors), 0040 (pago por-contractor) y 0041 (drop de
-- columnas de plata + trace_view money-free). Aplicar DESPUÉS de 0041.
--
-- Qué arregla respecto de la trace_view de 0041 (que dejó el join a payments por
-- invoice_id como en la vista original): en el modelo AGRUPADO una factura tiene N
-- pagos (uno por contractor), así que `join payments on p.invoice_id = i.id` hace
-- FAN-OUT (N filas por time entry) y no atribuye el pago/supplier# al contractor de
-- ESA hora. Acá se atribuye por la fila invoice_contractors cuyos entry_ids contienen
-- la hora: cada time entry se enlaza a SU contractor (y a su pago, vía payment_id),
-- sin fan-out. El supplier invoice number pasa a ser el de esa fila (por-contractor).
--
-- Legacy: las facturas single-contractor emitidas desde /time-entries ahora también
-- crean su fila invoice_contractors (createInvoice unificado al camino agrupado), así
-- que el join las cubre. Pagos legacy con invoice_id pero SIN fila invoice_contractors
-- (modelo viejo pre-04d) no aparecerían atribuidos — no existen en prod (invoices/
-- payments quedaron vacías) y no se re-generan. LIMITACIÓN PRE-EXISTENTE: los pagos
-- invoice-less (overage/sp_internal, invoice_id NULL) no aparecen en trace_view.

begin;

drop view if exists public.trace_view;

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
    i.sp_invoice_number,
    i.invoice_date,
    i.status                                    as invoice_status,
    i.payment_terms_days,
    i.created_at                                as invoiced_at,
    i.created_by                                as invoiced_by,
    -- Contractor de ESTA hora (fila invoice_contractors cuyos entry_ids la contienen).
    -- El supplier invoice number es por-contractor (se carga al pagar); reemplaza al
    -- viejo invoices.supplier_invoice_number single-contractor.
    ic.contractor                               as invoice_contractor,
    ic.supplier_invoice_number,
    ic.hours                                    as contractor_hours,
    -- Collections (agregadas) — se conservan (Collections fuera de uso; total 0).
    coalesce(ca.amount_collected, 0)            as collected_amount,
    ca.last_collection_date,
    coalesce(ca.collection_count, 0)            as collection_count,
    -- Payment del contractor de esta hora (vía invoice_contractors.payment_id). Sin
    -- monto: en horas. Atribución exacta, sin fan-out.
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
  left join public.invoice_contractors ic
    on ic.invoice_id = i.id
   and ic.entry_ids @> array[te.id]
  left join (
    select
      invoice_id,
      sum(amount_received)  as amount_collected,
      max(collection_date)  as last_collection_date,
      count(*)              as collection_count
    from public.collections
    group by invoice_id
  ) ca on ca.invoice_id = i.id
  left join public.payments p on p.id = ic.payment_id;

commit;
