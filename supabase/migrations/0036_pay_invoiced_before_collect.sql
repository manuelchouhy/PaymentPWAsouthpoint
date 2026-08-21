-- Flujo Billing → Payments (Collections no se usa por ahora): una factura emitida
-- en Billing (status 'Invoiced') se le puede pagar al contractor DIRECTO, sin
-- pasar por el cobro ('Collected'). Confirmado por el usuario (2026-08).
--
-- La función register_contractor_payment (schema_completo.sql · FR-10) validaba
-- que la factura estuviera en 'Collected'. Se recrea para aceptar también
-- 'Invoiced', y se registra el historial desde el estado REAL de la factura (no
-- 'Collected' hardcodeado), porque ahora puede venir de 'Invoiced'.
--
-- ⚠️ NO se aplicó a prod todavía: habilitar pagar-antes-de-cobrar es una decisión
-- de negocio; aplicar con revisión humana (junto con el resto del flujo).

create or replace function public.register_contractor_payment(
  p_invoice_id         bigint,
  p_amount_paid        numeric,
  p_payment_date       date,
  p_transfer_reference text    default null,
  p_bank_method        text    default null,
  p_notes              text    default null,
  p_back_dated         boolean default false,
  p_created_by         text    default null,
  p_exchange_rate      numeric default null
)
returns setof public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id  bigint;
  v_status      text;
  v_currency    text;
begin
  -- Bloquear la fila para evitar concurrencia
  select status, currency
    into v_status, v_currency
    from public.invoices
   where id = p_invoice_id
     for update;

  if not found then
    raise exception 'Invoice % not found', p_invoice_id;
  end if;

  -- Pagable si está emitida (Invoiced) o cobrada (Collected). NO Pending ni Paid.
  -- El prefijo 'not_collected:' se conserva para el manejo de error del cliente.
  if v_status not in ('Invoiced', 'Collected') then
    raise exception 'not_collected: invoice % is in status %, must be Invoiced or Collected',
      p_invoice_id, v_status;
  end if;

  -- Insertar el pago (el índice único rechazará un segundo pago)
  insert into public.payments (
    invoice_id, amount_paid, currency, exchange_rate,
    payment_date, transfer_reference, bank_method,
    notes, back_dated, created_by
  ) values (
    p_invoice_id, p_amount_paid, coalesce(v_currency, 'USD'), p_exchange_rate,
    p_payment_date, p_transfer_reference, p_bank_method,
    p_notes, p_back_dated, p_created_by
  )
  returning id into v_payment_id;

  -- Avanzar la invoice a 'Paid'
  update public.invoices set status = 'Paid' where id = p_invoice_id;

  -- Registrar en historial desde el estado REAL (Invoiced o Collected)
  insert into public.invoice_status_history
    (invoice_id, from_status, to_status, changed_by, note)
  values
    (p_invoice_id, v_status, 'Paid', p_created_by, 'Contractor payment registered');

  return query select * from public.payments where id = v_payment_id;
end;
$$;

revoke all on function public.register_contractor_payment from public;
grant execute on function public.register_contractor_payment to authenticated;
