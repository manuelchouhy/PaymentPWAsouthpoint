-- 0037 — Guarda anti doble-pago del overage.
--
-- Contexto: un pago de overage (invoice_id NULL) cubre horas concretas en
-- payments.entry_ids (bigint[]). Un pago POR FACTURA guarda sus horas en
-- invoices.entry_ids (y deja payments.entry_ids NULL).
--
-- Qué garantiza (alcance preciso): al INSERTAR/actualizar un pago de overage,
-- ninguna de sus horas puede estar ya cubierta por (a) otro pago de overage ni
-- (b) una factura. Es decir, el enforcement es del lado del pago de overage.
-- El caso inverso —facturar una hora que ya se pagó como overage— NO se enforce
-- en la BD a propósito: overage y bill_to_client son allocations DISJUNTAS y
-- createInvoice sólo toma horas bill_to_client aprobadas y no facturadas, así que
-- la app nunca factura una hora de overage. Poner un trigger espejo en invoices
-- penalizaría el hot-path de facturación (inserts en lote) por un caso que la
-- capa de app ya evita, así que se deja fuera y se documenta acá.
--
-- Atomicidad: un BEFORE-trigger con EXISTS NO alcanza bajo READ COMMITTED —dos
-- transacciones concurrentes no ven la fila no-commiteada de la otra y ambas
-- pasarían—. Como entry_ids es bigint[], no hay EXCLUDE/GiST nativo (intarray es
-- int4). Se serializa con advisory locks POR entry_id (uno por hora, tomados en
-- orden ascendente para no deadlockear): dos pagos con horas disjuntas no se
-- bloquean; dos que comparten una hora esperan uno al otro, y el segundo ve la
-- fila ya commiteada. Evita el cuello de botella de un lock global único.
--
-- Idempotente y aditivo: sólo valida filas NUEVAS/actualizadas; no toca el
-- histórico (verificado sin solapamientos antes de aplicar).

-- Índices GIN para que los chequeos de solape `&&` usen índice y no seq-scan.
create index if not exists payments_entry_ids_gin
  on public.payments using gin (entry_ids);
create index if not exists invoices_entry_ids_gin
  on public.invoices using gin (entry_ids);

create or replace function public.payments_entry_ids_no_overlap()
returns trigger
language plpgsql
as $$
begin
  -- Pagos por factura (o sin horas) no tienen entry_ids en payments que proteger.
  if new.entry_ids is null or array_length(new.entry_ids, 1) is null then
    return new;
  end if;

  -- Un advisory lock por hora, en orden ascendente (ver nota de atomicidad).
  perform pg_advisory_xact_lock(eid)
  from (select distinct unnest(new.entry_ids) as eid) s
  order by s.eid;

  -- ¿Ya cubierta por OTRO pago de overage? coalesce(new.id, -1) excluye la propia
  -- fila en UPDATE (en INSERT el id ya viene del default identity, aplicado antes
  -- de los triggers BEFORE).
  if exists (
    select 1 from public.payments p
    where p.id <> coalesce(new.id, -1)
      and p.entry_ids && new.entry_ids
  ) then
    raise exception 'hours already covered by another payment (entry_ids overlap)'
      using errcode = 'OV001';
  end if;

  -- ¿Ya cubierta por una FACTURA? Sus horas viven en invoices.entry_ids.
  if exists (
    select 1 from public.invoices i
    where i.entry_ids && new.entry_ids
  ) then
    raise exception 'hours already covered by an invoice (entry_ids overlap)'
      using errcode = 'OV001';
  end if;

  return new;
end;
$$;

drop trigger if exists payments_entry_ids_no_overlap on public.payments;
create trigger payments_entry_ids_no_overlap
  before insert or update of entry_ids on public.payments
  for each row
  execute function public.payments_entry_ids_no_overlap();
