-- 0052 — Pago PARCIAL de facturas por período (ADR 0005).
--
-- ⚠️ DRAFT / gated. Validada con smoke SQL en transacción con ROLLBACK (branching Pro no
-- disponible). NO aplicar a prod sin aprobación humana, y SÓLO junto con el slice 03
-- (paymentsData) — la firma de register_contractor_payment cambia (agrega p_entry_ids), así
-- que el caller viejo (8 args) fallaría con PGRST202 hasta que 03 lo reescriba. Es un slice
-- apilado. La UI que lee supplier#/payment de invoice_contractors (getInvoiceContractors)
-- pasa a leerlos de `payments` en el slice 04/05 (esas columnas de invoice_contractors quedan
-- vestigiales para el pago parcial).
--
-- PREREQUISITO: requiere 0039-0042 aplicadas (invoice_contractors, RPC por-contractor,
-- drop de columnas de plata, trace_view por-contractor). Verificado aplicado en el proyecto
-- (list_migrations: 0040/0041/0042 presentes). No re-dropea overloads de 0036 porque 0040 ya
-- los eliminó (queda un solo overload de register_contractor_payment antes de esta migración).
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

-- 1b) Backfill: los pagos legacy (0040) guardaron el supplier# en invoice_contractors. Se copia
--     a payments para que el nuevo lugar canónico (payments.supplier_invoice_number) no quede
--     NULL en el histórico.
update public.payments p
   set supplier_invoice_number = ic.supplier_invoice_number
  from public.invoice_contractors ic
 where ic.payment_id = p.id
   and p.supplier_invoice_number is null
   and ic.supplier_invoice_number is not null;

-- 2) Trigger anti-solape: excluir la PROPIA factura del chequeo contra invoices. Un pago de
--    factura (new.invoice_id no NULL) cubre por definición horas de invoices.entry_ids de SU
--    factura; sin esta exclusión el trigger lo rechazaría. Los pagos invoice-less
--    (new.invoice_id NULL → coalesce -1) siguen chequeando contra TODAS las facturas (ninguna
--    tiene id -1), preservando el comportamiento original 0037. El chequeo contra otros PAGOS
--    (doble-pago) queda igual y ahora también protege los pagos parciales entre sí.
create or replace function public.payments_entry_ids_no_overlap()
returns trigger
language plpgsql
set search_path = public
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
  v_line_ids  bigint[];
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
  -- Una línea pagada al modo LEGACY (0040: payment_id seteado, payments.entry_ids NULL) NO se
  -- puede volver a pagar: sus horas no viven en ningún payments.entry_ids, así que el trigger
  -- anti-solape no las ve y sin este guard se doble-pagarían.
  if v_ic.payment_id is not null then
    raise exception 'contractor_already_paid' using errcode = 'P0001';
  end if;
  -- Línea sin entry_ids (fila legacy anómala: el CHECK nonempty de 0040 es NOT VALID): sin esto,
  -- `p_entry_ids <@ NULL` = NULL y el subset check de abajo no dispararía, dejando pagar horas
  -- que no pertenecen a la línea.
  if v_ic.entry_ids is null or cardinality(v_ic.entry_ids) = 0 then
    raise exception 'invoice_contractor_no_entries' using errcode = 'P0001';
  end if;
  if p_supplier_invoice_number is null or btrim(p_supplier_invoice_number) = '' then
    raise exception 'supplier invoice number is required' using errcode = 'P0001';
  end if;
  -- payment_date es NOT NULL en payments: se valida acá para dar P0001 (que el caller mapea a un
  -- mensaje claro) en vez de un 23502 crudo al insertar.
  if p_payment_date is null then
    raise exception 'payment_date required' using errcode = 'P0001';
  end if;
  if p_entry_ids is null or cardinality(p_entry_ids) = 0 then
    raise exception 'entry_ids required' using errcode = 'P0001';
  end if;
  -- Normaliza (dedup) las horas a pagar: evita guardar entry_ids repetidos en payments (que un
  -- consumidor que cuente por longitud/unnest sin distinct doble-contaría).
  p_entry_ids := (select array_agg(distinct e) from unnest(p_entry_ids) as e);
  -- El subconjunto a pagar debe pertenecer a la línea del contractor.
  if not (p_entry_ids <@ v_ic.entry_ids) then
    raise exception 'entry_ids_not_in_line' using errcode = 'P0001';
  end if;

  -- La factura padre debe estar Invoiced (pagable). Lock para el flip atómico.
  select status into v_status
    from invoices where id = v_ic.invoice_id for update;
  if v_status is null then
    raise exception 'invoice_not_found' using errcode = 'P0002';
  end if;
  if v_status <> 'Invoiced' then
    raise exception 'invoice_not_payable' using errcode = 'P0001';
  end if;

  -- Pago del contractor CON entry_ids (el subconjunto) + supplier#. El trigger
  -- payments_entry_ids_no_overlap valida que ninguna de esas horas esté ya cubierta por otro
  -- pago (doble-pago) y rechaza el lote entero con OV001 si alguna hora ya está paga. El caller
  -- (paymentsData, slice 03) mapea OV001 a un aviso de "ya pagado / recargá", igual que hace
  -- con invoice_not_payable. La UI sólo ofrece horas pendientes, así que OV001 acá es sobre todo
  -- una carrera concurrente.
  insert into payments (invoice_id, entry_ids, user_name, supplier_invoice_number,
                        payment_date, transfer_reference, bank_method, notes, back_dated, created_by)
  values (v_ic.invoice_id, p_entry_ids, v_ic.contractor, btrim(p_supplier_invoice_number),
          p_payment_date, p_transfer_reference, p_bank_method, p_notes,
          coalesce(p_back_dated, false), p_created_by)
  returning * into v_payment;

  -- Horas CUBIERTAS de la factura: unión de (a) entry_ids de los pagos nuevos y (b) entry_ids de
  -- las líneas pagadas al modo LEGACY (0040: payment_id seteado, payments.entry_ids NULL) — así
  -- una factura mixta (parte legacy, parte nueva) igual puede llegar a Paid.
  select coalesce(array_agg(distinct e), '{}')
    into v_covered
    from (
      select unnest(p.entry_ids) as e
        from public.payments p
       where p.invoice_id = v_ic.invoice_id
      union
      select unnest(icx.entry_ids) as e
        from public.invoice_contractors icx
       where icx.invoice_id = v_ic.invoice_id
         and icx.payment_id is not null
    ) s;

  -- Horas PAGABLES de la factura = unión de los entry_ids de sus líneas de contractor. Se usa
  -- esto (no invoices.entry_ids) para el flip: es lo que realmente se paga, y así un drift entre
  -- invoices.entry_ids y las líneas no deja la factura atascada en Invoiced.
  select coalesce(array_agg(distinct e), '{}')
    into v_line_ids
    from public.invoice_contractors icx, unnest(icx.entry_ids) as e
   where icx.invoice_id = v_ic.invoice_id;

  -- Flip a 'Paid' ATÓMICO: todas las horas pagables cubiertas. cardinality > 0 evita que una
  -- factura sin líneas ('{}' <@ cualquier_cosa = TRUE) flipee sin cubrir nada. La factura está
  -- lockeada, así que el cálculo es consistente aunque dos pagos entren casi a la vez.
  if cardinality(v_line_ids) > 0 and v_line_ids <@ v_covered then
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

-- 4) trace_view: atribuir el pago de CADA hora por payments.entry_ids (la hora que el pago
--    cubre), no por invoice_contractors.payment_id — que la RPC nueva ya no setea, y que con
--    pagos parciales no puede representar los N pagos de una línea. El supplier# pasa a leerse
--    de payments (por pago). Sigue sin fan-out: cada time entry matchea a lo sumo un pago (los
--    entry_ids no se solapan entre pagos, trigger 0037/0052). Los pagos legacy (entry_ids NULL)
--    no matchean por hora; su atribución legacy vía ic.payment_id se pierde en la vista, pero en
--    prod esas horas ya están en facturas Paid y la Traceability aún no está habilitada en la UI.
drop view if exists public.trace_view;
create or replace view public.trace_view
  with (security_invoker = true)
as
  select
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
    i.id                                        as invoice_id,
    i.sp_invoice_number,
    i.invoice_date,
    i.status                                    as invoice_status,
    i.payment_terms_days,
    i.created_at                                as invoiced_at,
    i.created_by                                as invoiced_by,
    ic.contractor                               as invoice_contractor,
    ic.hours                                    as contractor_hours,
    coalesce(ca.amount_collected, 0)            as collected_amount,
    ca.last_collection_date,
    coalesce(ca.collection_count, 0)            as collection_count,
    -- Pago que cubre ESTA hora + su supplier#. Dos joins SEPARADOS (no un OR, que anularía el
    -- índice GIN): pn = pago nuevo por entry_ids (usa payments_entry_ids_gin); pl = pago legacy
    -- 0040 por link ic.payment_id (usa la PK). Son mutuamente excluyentes por hora (una línea es
    -- legacy-paga O nueva-paga, nunca ambas), así que el COALESCE toma el que exista.
    coalesce(pn.id, pl.id)                                    as payment_id,
    coalesce(pn.supplier_invoice_number, pl.supplier_invoice_number) as supplier_invoice_number,
    coalesce(pn.payment_date, pl.payment_date)                as payment_date,
    coalesce(pn.transfer_reference, pl.transfer_reference)    as transfer_reference,
    coalesce(pn.bank_method, pl.bank_method)                  as bank_method,
    coalesce(pn.notes, pl.notes)                              as payment_notes,
    coalesce(pn.created_at, pl.created_at)                    as paid_at,
    coalesce(pn.created_by, pl.created_by)                    as paid_by
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
  -- pn: pago nuevo por entry_ids, ACOTADO a la misma factura (pn.invoice_id = i.id) para no
  -- traer pagos invoice-less (overage/sp_internal, invoice_id NULL) a trace_view — que 0042 no
  -- mostraba. pl: pago legacy 0040 por link ic.payment_id.
  left join public.payments pn
    on pn.invoice_id = i.id and pn.entry_ids @> array[te.id]
  left join public.payments pl on pl.id = ic.payment_id;

-- 5) Actualiza el comment de payments.entry_ids: con el pago parcial, los pagos POR FACTURA ya
--    NO dejan entry_ids NULL — llevan el subconjunto cubierto. Invierte la nota de 0035.
comment on column public.payments.entry_ids is
  'Horas cubiertas por el pago (bigint[]). overage/sp_internal: sus horas. Pagos por factura: '
  'el subconjunto cubierto (pago parcial por período, 0052). Pagos legacy por factura (0040) '
  'quedaron con NULL. La clasificación overage vs factura se hace por invoice_id, NO por si '
  'entry_ids es NULL.';

commit;
