-- 0052 — Pago PARCIAL de facturas por período (ADR 0005).
--
-- ⚠️ DRAFT / gated. Probar en un BRANCH de Supabase con smoke SQL. NO aplicar a prod
-- sin aprobación humana, y SÓLO junto con el slice 03 (paymentsData) — la firma de
-- register_contractor_payment cambia (agrega p_entry_ids), así que el caller viejo
-- (8 args) fallaría con PGRST202 hasta que 03 lo reescriba. Es un slice apilado.
--
-- Qué cambia:
--   1. payments.supplier_invoice_number: el supplier# pasa a vivir POR PAGO (antes
--      vivía en invoice_contractors, uno por línea). Con pagos parciales una línea
--      tiene varios pagos, cada uno con su comprobante.
--   2. register_contractor_payment: recibe p_entry_ids (SUBCONJUNTO de las horas de la
--      línea) + supplier#, inserta el pago CON entry_ids, y flipea la factura a 'Paid'
--      cuando TODAS las horas de la factura (invoices.entry_ids) están cubiertas por
--      pagos. "paid" deja de depender de invoice_contractors.payment_id: se deriva de la
--      cobertura por entry_ids (consistente con invoiceCompletion.js).
--   3. payments_entry_ids_no_overlap: permite que un pago cubra horas de SU PROPIA
--      factura (i.id <> new.invoice_id), sin dejar de bloquear el doble-pago entre pagos
--      ni que un pago invoice-less cubra horas ya facturadas de OTRA factura.

begin;

-- 1) Supplier# por pago (nullable a nivel columna; el RPC lo exige para pagos de factura).
alter table public.payments
  add column if not exists supplier_invoice_number text;

-- 2) Trigger anti-solape: excluir la PROPIA factura del chequeo contra invoices. Un pago de
--    factura (new.invoice_id no NULL) cubre por definición horas de invoices.entry_ids de SU
--    factura; sin esta exclusión el trigger lo rechazaría. Los pagos invoice-less
--    (new.invoice_id NULL → coalesce -1) siguen chequeando contra TODAS las facturas (ninguna
--    tiene id -1), preservando el comportamiento original 0037. El chequeo contra otros PAGOS
--    (doble-pago) queda igual y ahora también protege los pagos parciales entre sí.
create or replace function public.payments_entry_ids_no_overlap()
returns trigger
language plpgsql
as $$
declare
  r record;
begin
  if new.entry_ids is null or array_length(new.entry_ids, 1) is null then
    return new;
  end if;

  for r in
    select distinct e as eid
    from unnest(new.entry_ids) as e
    where e is not null
    order by eid
  loop
    perform pg_advisory_xact_lock(hashtextextended('payments_overage_entry:' || r.eid, 0));
  end loop;

  -- ¿Ya cubierta por OTRO pago? (doble-pago; incluye pagos parciales entre sí)
  if exists (
    select 1 from public.payments p
    where p.id <> coalesce(new.id, -1)
      and p.entry_ids && new.entry_ids
  ) then
    raise exception 'hours already covered by another payment (entry_ids overlap)'
      using errcode = 'OV001';
  end if;

  -- ¿Ya cubierta por OTRA factura? Se excluye la propia (new.invoice_id): un pago de factura
  -- cubre horas de su propia invoices.entry_ids legítimamente.
  if exists (
    select 1 from public.invoices i
    where i.entry_ids && new.entry_ids
      and i.id <> coalesce(new.invoice_id, -1)
  ) then
    raise exception 'hours already covered by an invoice (entry_ids overlap)'
      using errcode = 'OV001';
  end if;

  return new;
end;
$$;

-- 3) RPC de pago por contractor con SUBCONJUNTO de horas. Firma nueva (agrega p_entry_ids).
drop function if exists public.register_contractor_payment(
  bigint, text, date, text, text, text, boolean, text);

create or replace function public.register_contractor_payment(
  p_invoice_contractor_id   bigint,
  p_entry_ids               bigint[],
  p_supplier_invoice_number text,
  p_payment_date            date,
  p_transfer_reference      text,
  p_bank_method             text,
  p_notes                   text,
  p_back_dated              boolean,
  p_created_by              text
)
returns payments
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ic        invoice_contractors;
  v_status    text;
  v_inv_entry bigint[];
  v_covered   bigint[];
  v_payment   payments;
begin
  -- Fila del contractor + lock (serializa pagos concurrentes de la misma línea).
  select * into v_ic
    from invoice_contractors
   where id = p_invoice_contractor_id
   for update;
  if v_ic.id is null then
    raise exception 'invoice_contractor_not_found' using errcode = 'P0002';
  end if;
  if p_supplier_invoice_number is null or btrim(p_supplier_invoice_number) = '' then
    raise exception 'supplier invoice number is required' using errcode = 'P0001';
  end if;
  if p_entry_ids is null or cardinality(p_entry_ids) = 0 then
    raise exception 'entry_ids required' using errcode = 'P0001';
  end if;
  -- El subconjunto a pagar debe pertenecer a la línea del contractor.
  if not (p_entry_ids <@ v_ic.entry_ids) then
    raise exception 'entry_ids_not_in_line' using errcode = 'P0001';
  end if;

  -- La factura padre debe estar Invoiced (pagable). Lock para el flip atómico.
  select status, entry_ids into v_status, v_inv_entry
    from invoices where id = v_ic.invoice_id for update;
  if v_status is null then
    raise exception 'invoice_not_found' using errcode = 'P0002';
  end if;
  if v_status <> 'Invoiced' then
    raise exception 'invoice_not_payable' using errcode = 'P0001';
  end if;

  -- Pago del contractor CON entry_ids (el subconjunto) + supplier#. El trigger
  -- payments_entry_ids_no_overlap valida que ninguna de esas horas esté ya cubierta por
  -- otro pago (doble-pago) → mensaje claro si el usuario reintenta horas ya pagas.
  insert into payments (invoice_id, entry_ids, user_name, supplier_invoice_number,
                        payment_date, transfer_reference, bank_method, notes, back_dated, created_by)
  values (v_ic.invoice_id, p_entry_ids, v_ic.contractor, btrim(p_supplier_invoice_number),
          p_payment_date, p_transfer_reference, p_bank_method, p_notes,
          coalesce(p_back_dated, false), p_created_by)
  returning * into v_payment;

  -- Flip a 'Paid' ATÓMICO por COBERTURA: todas las horas de la factura (invoices.entry_ids)
  -- cubiertas por la unión de entry_ids de sus pagos. La factura está lockeada, así que el
  -- cálculo es consistente aunque dos pagos entren casi a la vez.
  select coalesce(array_agg(distinct e), '{}')
    into v_covered
    from public.payments p, unnest(p.entry_ids) as e
   where p.invoice_id = v_ic.invoice_id;

  if v_inv_entry is not null and v_inv_entry <@ v_covered then
    update invoices set status = 'Paid'
     where id = v_ic.invoice_id and status = 'Invoiced';
    insert into invoice_status_history (invoice_id, from_status, to_status, changed_by, note)
    values (v_ic.invoice_id, 'Invoiced', 'Paid', p_created_by,
            'All invoice hours covered (partial payments)');
  end if;

  return v_payment;
end;
$$;

revoke all on function public.register_contractor_payment(
  bigint, bigint[], text, date, text, text, text, boolean, text) from public;
grant execute on function public.register_contractor_payment(
  bigint, bigint[], text, date, text, text, text, boolean, text) to authenticated;

commit;
