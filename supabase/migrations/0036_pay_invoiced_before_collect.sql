-- Flujo Billing → Payments (Collections no se usa por ahora): una factura emitida
-- en Billing (status 'Invoiced') se le puede pagar al contractor DIRECTO, sin
-- pasar por el cobro ('Collected'). Confirmado por el usuario (2026-08).
--
-- APLICADA a prod (SouthPointApp) el 2026-08-21. Recrea el overload de 9 params de
-- register_contractor_payment (el que usa el cliente) para aceptar también
-- 'Invoiced'. Se calcó la definición REAL deployada (RETURNS payments, fila única;
-- SECURITY INVOKER; ERRCODE P0001 'not_collected'), NO la de schema_completo.sql
-- (que estaba desincronizada como `setof ... security definer`). Cambios mínimos:
--   - guard: v_status IN ('Invoiced','Collected') en vez de = 'Collected'.
--   - UPDATE invoices ... AND status = v_status (antes 'Collected' fijo — para
--     Invoiced no matcheaba y no pasaba a Paid).
--   - invoice_status_history.from_status = v_status (antes 'Collected' fijo).
-- El overload legacy de 8 params queda como está (no se llama desde el cliente).
--
-- DROP + CREATE (no CREATE OR REPLACE): un entorno fresco construido desde
-- schema_completo.sql tiene la función con `returns setof payments`, y Postgres no
-- deja cambiar el tipo de retorno con REPLACE. El DROP hace la migración
-- reproducible sobre cualquier base. A prod se le aplicó como CREATE OR REPLACE
-- (ya había derivado a `returns payments`); es equivalente. NOTA: la función
-- deployada en prod es SECURITY INVOKER sin `search_path` (drift preexistente);
-- alinear ese hardening es una decisión de seguridad aparte.
DROP FUNCTION IF EXISTS public.register_contractor_payment(
  bigint, numeric, date, text, text, text, boolean, text, numeric);

CREATE OR REPLACE FUNCTION public.register_contractor_payment(
  p_invoice_id bigint,
  p_amount_paid numeric,
  p_payment_date date,
  p_transfer_reference text,
  p_bank_method text,
  p_notes text,
  p_back_dated boolean,
  p_created_by text,
  p_exchange_rate numeric DEFAULT NULL::numeric
)
RETURNS payments
LANGUAGE plpgsql
AS $function$
DECLARE
  v_status  text;
  v_payment payments;
BEGIN
  SELECT status INTO v_status FROM invoices WHERE id = p_invoice_id FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'invoice_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Pagable si está emitida (Invoiced) o cobrada (Collected). NO Pending ni Paid.
  IF v_status NOT IN ('Invoiced', 'Collected') THEN
    RAISE EXCEPTION 'not_collected' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO payments(invoice_id, amount_paid, payment_date, transfer_reference,
                       bank_method, notes, back_dated, created_by, exchange_rate)
  VALUES (p_invoice_id, p_amount_paid, p_payment_date, p_transfer_reference,
          p_bank_method, p_notes, p_back_dated, p_created_by, p_exchange_rate)
  RETURNING * INTO v_payment;

  UPDATE invoices SET status = 'Paid' WHERE id = p_invoice_id AND status = v_status;

  INSERT INTO invoice_status_history(invoice_id, from_status, to_status, changed_by, note)
  VALUES (p_invoice_id, v_status, 'Paid', p_created_by, 'Contractor payment registered');

  RETURN v_payment;
END;
$function$;

-- El DROP borra los grants; se re-otorgan (igual que la función original).
REVOKE ALL ON FUNCTION public.register_contractor_payment(
  bigint, numeric, date, text, text, text, boolean, text, numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.register_contractor_payment(
  bigint, numeric, date, text, text, text, boolean, text, numeric) TO authenticated;
