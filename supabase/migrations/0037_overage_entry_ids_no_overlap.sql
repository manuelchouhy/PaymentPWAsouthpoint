-- 0037 — Guarda anti doble-pago del overage.
--
-- Contexto: un pago de overage (invoice_id NULL) cubre horas concretas en
-- payments.entry_ids (bigint[]). Un pago POR FACTURA guarda sus horas en
-- invoices.entry_ids (y deja payments.entry_ids NULL). El invariante a garantizar
-- es: ninguna hora (entry_id) puede quedar cubierta por dos cosas a la vez — ni
-- por dos pagos de overage, ni por un overage y una factura.
--
-- El path por factura ya tenía el índice único payments_invoice_id_unique, pero
-- el overage era un insert directo sin garantía. Con el pago PARCIAL de horas la
-- superficie de doble-pago crece, así que lo cerramos en la base.
--
-- Enfoque: trigger BEFORE INSERT/UPDATE que rechaza el pago si alguno de sus
-- entry_ids ya está cubierto por otro pago de overage O por una factura. Se usa
-- el operador de solape de arrays `&&` (nativo para cualquier array; NO requiere
-- intarray, que sólo aplica a int[]).
--
-- Atomicidad: un BEFORE-trigger con EXISTS NO alcanza bajo READ COMMITTED —dos
-- transacciones concurrentes no ven la fila no-commiteada de la otra y ambas
-- pasarían el chequeo—. Como entry_ids es bigint[], no hay EXCLUDE/GiST nativo
-- (intarray es int4). Se serializa con pg_advisory_xact_lock: la segunda inserción
-- concurrente espera al commit de la primera y recién ahí corre su EXISTS, que ya
-- ve la fila. Lock por transacción, clave fija → sólo serializa pagos con horas.
--
-- Idempotente y aditivo: sólo valida filas NUEVAS/actualizadas; no toca el
-- histórico (verificado sin solapamientos antes de aplicar).

-- Índice GIN para que el chequeo de solape `&&` use índice y no seq-scan.
create index if not exists payments_entry_ids_gin
  on public.payments using gin (entry_ids);

create or replace function public.payments_entry_ids_no_overlap()
returns trigger
language plpgsql
as $$
begin
  -- Pagos por factura (o sin horas) no tienen entry_ids en payments que proteger.
  if new.entry_ids is null or array_length(new.entry_ids, 1) is null then
    return new;
  end if;

  -- Serializa los inserts/updates de overage entre sí (ver nota de atomicidad).
  perform pg_advisory_xact_lock(hashtext('payments_entry_ids_no_overlap')::bigint);

  -- ¿Ya cubierta por OTRO pago de overage? coalesce(new.id, -1) excluye la propia
  -- fila en UPDATE (en INSERT el id ya viene del default identity, aplicado antes
  -- de los triggers BEFORE).
  if exists (
    select 1 from public.payments p
    where p.id <> coalesce(new.id, -1)
      and p.entry_ids && new.entry_ids
  ) then
    raise exception
      'One or more of these hours are already covered by another payment (entry_ids overlap)'
      using errcode = '23505';
  end if;

  -- ¿Ya cubierta por una FACTURA? Sus horas viven en invoices.entry_ids, no en
  -- payments.entry_ids, así que el chequeo de arriba no las ve.
  if exists (
    select 1 from public.invoices i
    where i.entry_ids && new.entry_ids
  ) then
    raise exception
      'One or more of these hours are already covered by an invoice (entry_ids overlap)'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists payments_entry_ids_no_overlap on public.payments;
create trigger payments_entry_ids_no_overlap
  before insert or update of entry_ids on public.payments
  for each row
  execute function public.payments_entry_ids_no_overlap();
