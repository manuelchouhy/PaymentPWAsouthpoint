-- 0040 — Payments: pago POR CONTRACTOR bajo una factura agrupada (en horas).
--
-- ⚠️ DRAFT / NO APLICADO. Escrita por el agente (slice 04c) para revisión humana.
-- No se corrió contra ninguna base. Aplicar sólo tras revisarla. Es la contraparte
-- de la fundación 0039 (que creó invoice_contractors y la emisión agrupada).
--
-- Qué cambia (todo ADITIVO/reversible; el DROP de columnas de plata va aparte, en
-- 0041, por ser destructivo y depender de que la app deje de usarlas):
--   1. Relaja el NOT NULL de las columnas de plata de payments, para poder insertar
--      un pago SIN monto (el modelo se mide en horas). El drop total va en 0041.
--   2. Quita el índice único payments_invoice_id_unique: con el pago por-contractor
--      una misma factura tiene VARIOS pagos (uno por contractor). Ese índice era el
--      backstop "un pago por factura"; su reemplazo es invoice_contractors.payment_id
--      (una vez seteado, ese contractor no se re-paga; lo enforce el RPC de abajo).
--   3. CHECK: invoice_contractors.entry_ids no puede ser vacío. Cierra el hueco que
--      invoiceCompletion.js/payableInvoicesByContractor tuvieron que sortear en JS:
--      una fila sin entry_ids no representa trabajo y no debe existir. Así UI (que la
--      excluye) y DB (que la contaría) nunca divergen.
--   4. Reescribe register_contractor_payment: pasa a recibir UNA fila
--      invoice_contractors y registrar SU pago (supplier# + fecha + operativos). La
--      factura pasa a 'Paid' de forma ATÓMICA sólo cuando TODAS sus filas hijas
--      tienen payment_id.
--
-- ⚠️ Rompe el flujo viejo de Payments (single-contractor) hasta que 04d rewire la UI
-- y la capa de datos: se DROPEAN los overloads viejos de register_contractor_payment.
-- Es un slice apilado; se aplica junto con 04d, no suelto en prod.

begin;

-- 1) Plata nullable en payments (drop total en 0041). Un pago por-contractor no
--    carga monto/moneda/TC: sin esto, el INSERT del RPC violaría el NOT NULL (23502).
alter table public.payments
  alter column amount_paid drop not null,
  alter column currency    drop not null;

-- 2) Fuera el "un pago por factura": ahora hay N pagos por factura (uno por contractor).
--    El anti doble-pago por contractor lo da invoice_contractors.payment_id (abajo).
drop index if exists public.payments_invoice_id_unique;

-- 3) invoice_contractors.entry_ids no vacío. NOT VALID: enforce las filas NUEVAS sin
--    revalidar el histórico (por si quedara alguna fila vieja vacía; las de QA ya se
--    limpiaron). create_grouped_invoice (0039) ya garantiza ≥1 entry_id por fila, así
--    que ningún alta legítima lo viola.
alter table public.invoice_contractors
  drop constraint if exists invoice_contractors_entry_ids_nonempty;
alter table public.invoice_contractors
  add constraint invoice_contractors_entry_ids_nonempty
  check (array_length(entry_ids, 1) >= 1) not valid;

-- 4) Pago por contractor. Se DROPEAN los overloads viejos (8 y 9 params, ver 0036) y
--    se crea la nueva firma por invoice_contractor. SECURITY INVOKER + search_path
--    fijo (endurece el drift que 0036 documentó en la versión vieja).
drop function if exists public.register_contractor_payment(
  bigint, numeric, date, text, text, text, boolean, text, numeric);
drop function if exists public.register_contractor_payment(
  bigint, numeric, date, text, text, text, boolean, text);

create or replace function public.register_contractor_payment(
  p_invoice_contractor_id   bigint,
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
  v_payment   payments;
  v_remaining integer;
begin
  -- Fila del contractor + lock: dos pagos concurrentes del MISMO contractor se
  -- serializan acá y el segundo ve payment_id ya seteado → error legible.
  select * into v_ic
    from invoice_contractors
   where id = p_invoice_contractor_id
   for update;
  if v_ic.id is null then
    raise exception 'invoice_contractor_not_found' using errcode = 'P0002';
  end if;
  if v_ic.payment_id is not null then
    raise exception 'contractor_already_paid' using errcode = 'P0001';
  end if;
  if p_supplier_invoice_number is null or btrim(p_supplier_invoice_number) = '' then
    raise exception 'supplier invoice number is required' using errcode = 'P0001';
  end if;

  -- La factura padre debe estar Invoiced (pagable). Lock para el flip atómico de abajo.
  select status into v_status from invoices where id = v_ic.invoice_id for update;
  if v_status is null then
    raise exception 'invoice_not_found' using errcode = 'P0002';
  end if;
  if v_status <> 'Invoiced' then
    -- Ya Paid (todo pago) o estado no pagable. Carrera típica: dos usuarios pagando
    -- el último contractor a la vez → el segundo cae acá con error legible + recargar.
    raise exception 'invoice_not_payable' using errcode = 'P0001';
  end if;

  -- Pago del contractor. entry_ids queda NULL A PROPÓSITO: las horas ya viven en
  -- invoices.entry_ids (unión denormalizada) y ahí las congela/anti-doble-paga el
  -- modelo. Si se guardaran acá, el trigger 0037 las vería solapando su PROPIA
  -- factura y rechazaría el pago. user_name = contractor para trazar el pago.
  -- Sin amount_paid/currency/exchange_rate: el modelo es en horas (0041 dropea esas
  -- columnas; acá ya son nullable).
  insert into payments (invoice_id, user_name, payment_date, transfer_reference,
                        bank_method, notes, back_dated, created_by)
  values (v_ic.invoice_id, v_ic.contractor, p_payment_date, p_transfer_reference,
          p_bank_method, p_notes, coalesce(p_back_dated, false), p_created_by)
  returning * into v_payment;

  -- Enlaza el pago a la fila del contractor: supplier# + fecha + payment_id.
  update invoice_contractors
     set payment_id              = v_payment.id,
         supplier_invoice_number = btrim(p_supplier_invoice_number),
         payment_date            = p_payment_date
   where id = v_ic.id;

  -- Flip a 'Paid' ATÓMICO: sólo si NINGUNA fila hija queda sin payment_id. Como la
  -- factura está lockeada (FOR UPDATE arriba), el conteo es consistente aunque dos
  -- contractors se paguen casi a la vez: el segundo espera el lock y ve al primero.
  select count(*) into v_remaining
    from invoice_contractors
   where invoice_id = v_ic.invoice_id
     and payment_id is null;

  if v_remaining = 0 then
    update invoices set status = 'Paid'
     where id = v_ic.invoice_id and status = 'Invoiced';
    insert into invoice_status_history (invoice_id, from_status, to_status, changed_by, note)
    values (v_ic.invoice_id, 'Invoiced', 'Paid', p_created_by,
            'All contractors paid (per-contractor payment)');
  end if;

  return v_payment;
end;
$$;

revoke all on function public.register_contractor_payment(
  bigint, text, date, text, text, text, boolean, text) from public;
grant execute on function public.register_contractor_payment(
  bigint, text, date, text, text, text, boolean, text) to authenticated;

commit;
