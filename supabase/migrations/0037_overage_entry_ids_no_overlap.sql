-- 0037 — Guarda anti doble-pago del overage.
--
-- Contexto: un pago de overage (invoice_id NULL) cubre horas concretas en
-- payments.entry_ids (bigint[]). El path por factura ya está protegido por el
-- índice único payments_invoice_id_unique, pero el overage era un insert directo
-- sin ninguna garantía a nivel BD de que una misma hora no se pagara dos veces
-- (p. ej. dos sesiones simultáneas cubriendo entry_ids solapados). Con el pago
-- PARCIAL de horas esa superficie crece, así que lo cerramos en la base.
--
-- Enfoque: un trigger BEFORE INSERT/UPDATE que rechaza el pago si alguno de sus
-- entry_ids ya está cubierto por OTRO pago. Se usa el operador de solapamiento de
-- arrays `&&` (nativo para cualquier array; NO requiere la extensión intarray, que
-- sólo aplica a int[]). No se normaliza a tabla hija para no reescribir la capa de
-- datos ni las lecturas (paidEntryIdsFrom, PAYMENT_COLUMNS) que ya tratan
-- entry_ids como bigint[].
--
-- Idempotente y aditivo: sólo valida filas NUEVAS/actualizadas; no toca ni valida
-- el histórico (que ya se verificó sin solapamientos antes de aplicar).

-- Índice GIN para que el chequeo de solapamiento `&&` use índice y no seq-scan.
create index if not exists payments_entry_ids_gin
  on public.payments using gin (entry_ids);

create or replace function public.payments_entry_ids_no_overlap()
returns trigger
language plpgsql
as $$
begin
  -- Pagos por factura (o sin horas) no tienen entry_ids que proteger.
  if new.entry_ids is null or array_length(new.entry_ids, 1) is null then
    return new;
  end if;

  -- ¿Alguna de estas horas ya está cubierta por otro pago? coalesce(new.id, -1)
  -- excluye la propia fila en UPDATE (en INSERT el id ya viene resuelto por el
  -- default identity, que se aplica antes de los triggers BEFORE).
  if exists (
    select 1
    from public.payments p
    where p.id <> coalesce(new.id, -1)
      and p.entry_ids && new.entry_ids
  ) then
    raise exception
      'One or more of these hours are already covered by another payment (entry_ids overlap)'
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
