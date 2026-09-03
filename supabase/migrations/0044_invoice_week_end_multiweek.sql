-- =============================================================================
-- 0044 — Factura multi-semana: columna week_end + RPC create_grouped_invoice
-- =============================================================================
-- Feature: una factura agrupada puede cubrir VARIAS semanas del mismo
-- cliente+proyecto (contiguas o no). El período se guarda como rango:
--   week_start = domingo de la PRIMERA semana,  week_end = domingo de la ÚLTIMA.
-- Ambos son domingos que IDENTIFICAN la semana (mismo criterio que week_start en
-- todo el dominio; ver CONTEXT.md), NO el último día calendario.
--
-- week_end es NULLABLE: las facturas existentes (y las de una sola semana) quedan
-- con week_end = null → se interpretan como semana única (sin migración de datos
-- retroactiva).
--
-- Orden: aplicar DESPUÉS de 0039-0043. Redeploy del frontend coordinado con esta
-- migración (data.js pasa p_week_end). El nuevo parámetro va con DEFAULT null para
-- que un frontend viejo cacheado (service worker) que llame sin p_week_end siga
-- resolviendo durante la transición.
--
-- Cómo correrlo: Supabase → SQL Editor → pegar y ejecutar (o supabase db push).
-- =============================================================================

-- 1) Columna del rango. Idempotente y nullable.
alter table public.invoices
  add column if not exists week_end date;

comment on column public.invoices.week_end is
  'Domingo de la ÚLTIMA semana del período facturado (week-identifier, no el último '
  'día calendario). null = factura de una sola semana (week_start). Ver migración 0044.';

-- 2) RPC create_grouped_invoice + p_week_end.
--    Se DROPEA la firma anterior (7 args) y se re-crea con p_week_end al final,
--    con DEFAULT null (backward-compat para llamadores que aún no lo mandan).
--    El cuerpo es idéntico al de 0039 salvo el insert de week_end.
drop function if exists public.create_grouped_invoice(
  text, text, text, date, text, text, jsonb);

create or replace function public.create_grouped_invoice(
  p_sp_invoice_number text,
  p_project           text,
  p_client            text,
  p_week_start        date,
  p_notes             text,
  p_created_by        text,
  p_contractors       jsonb,
  p_week_end          date default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_invoice   invoices;
  v_c         jsonb;
  v_entry_ids bigint[];
  r           record;
begin
  if p_sp_invoice_number is null or btrim(p_sp_invoice_number) = '' then
    raise exception 'sp invoice number is required' using errcode = 'P0001';
  end if;
  if exists (select 1 from invoices where sp_invoice_number = btrim(p_sp_invoice_number)) then
    raise exception 'sp_invoice_number already exists' using errcode = '23505';
  end if;
  -- Coherencia con el guard del SP number: una factura agrupada necesita al menos
  -- un contractor (si no, sería una factura Invoiced vacía). El builder JS ya lo
  -- exige; se replica acá para el caso de llamada directa al RPC.
  if p_contractors is null or jsonb_array_length(p_contractors) = 0 then
    raise exception 'a grouped invoice needs at least one contractor' using errcode = 'P0001';
  end if;

  -- invoices.entry_ids (la union denormalizada que lee el anti-doble-pago) se
  -- DERIVA de las filas por-contractor, no se recibe aparte: así no puede diverger
  -- del detalle de invoice_contractors. Una sola fuente de verdad.
  select coalesce(array_agg(distinct x::bigint), '{}')
    into v_entry_ids
    from jsonb_array_elements(coalesce(p_contractors, '[]'::jsonb)) as c,
         jsonb_array_elements_text(c -> 'entry_ids') as x;

  -- Guard anti-doble-factura ATÓMICO: ninguna hora puede estar ya cubierta por
  -- otra factura ni por un pago de overage. Se serializa por-hora con advisory
  -- locks tomados en orden ascendente (un FOR LOOP garantiza el orden de
  -- adquisición; un PERFORM con ORDER BY sobre la target-list NO), usando EL MISMO
  -- namespace de lock que el trigger de pagos 0037 ('payments_overage_entry:'):
  -- así dos emisiones concurrentes con horas compartidas —o una emisión y un pago
  -- de overage— esperan una a la otra y la segunda ve la fila ya commiteada. Con
  -- el lock, los EXISTS de abajo son exactos incluso bajo concurrencia. La capa de
  -- app (freeze de entry_ids) sigue siendo la guarda primaria.
  if array_length(v_entry_ids, 1) is not null then
    for r in
      select distinct e as eid
      from unnest(v_entry_ids) as e
      where e is not null
      order by eid
    loop
      perform pg_advisory_xact_lock(hashtextextended('payments_overage_entry:' || r.eid, 0));
    end loop;

    if exists (select 1 from invoices where entry_ids && v_entry_ids) then
      raise exception 'hours already covered by an invoice (entry_ids overlap)'
        using errcode = 'OV001';
    end if;
    if exists (select 1 from payments where entry_ids && v_entry_ids) then
      raise exception 'hours already covered by a payment (entry_ids overlap)'
        using errcode = 'OV001';
    end if;
  end if;

  -- Único cambio vs 0039: se persiste week_end junto a week_start (el rango).
  insert into invoices (sp_invoice_number, project, client, week_start, week_end, notes,
                        entry_ids, status, created_by)
  values (btrim(p_sp_invoice_number), p_project, p_client, p_week_start, p_week_end, p_notes,
          v_entry_ids, 'Invoiced', p_created_by)
  returning * into v_invoice;

  for v_c in select * from jsonb_array_elements(coalesce(p_contractors, '[]'::jsonb))
  loop
    declare
      v_child_ids bigint[];
    begin
      -- entry_ids de la hija: DISTINCT (igual que la union) para no guardar ids
      -- repetidos si un llamador directo del RPC (bypass del builder JS) los manda.
      select coalesce(array_agg(distinct x::bigint), '{}')
        into v_child_ids
        from jsonb_array_elements_text(v_c -> 'entry_ids') as x;

      -- Cada contractor aporta ≥1 hora, y esas horas deben existir en time_entries:
      -- si no, el sum() daría NULL→0 y la fila quedaría con entry_ids poblado y
      -- hours=0 (la divergencia que el modelo dice evitar). Se valida acá para que
      -- hours (derivado abajo) sea siempre exacto respecto de sus entry_ids.
      if array_length(v_child_ids, 1) is null then
        raise exception 'contractor % has no hours', v_c ->> 'contractor'
          using errcode = 'P0001';
      end if;
      if (select count(*) from time_entries where id = any(v_child_ids))
           <> array_length(v_child_ids, 1) then
        raise exception 'some entry_ids do not exist in time_entries'
          using errcode = 'P0001';
      end if;

      -- hours NO se confía del cliente: se DERIVA sumando time_entries de esos
      -- entry_ids (fuente autoritativa). Así invoice_contractors.hours no puede
      -- diverger de sus entry_ids ni aunque se llame al RPC directo con hours falso.
      insert into invoice_contractors (invoice_id, contractor, entry_ids, hours)
      values (
        v_invoice.id,
        v_c ->> 'contractor',
        v_child_ids,
        (select sum(hours) from time_entries where id = any(v_child_ids))
      );
    end;
  end loop;

  return jsonb_build_object(
    'invoice', to_jsonb(v_invoice),
    'contractors', coalesce(
      (select jsonb_agg(to_jsonb(ic) order by ic.id)
         from invoice_contractors ic
        where ic.invoice_id = v_invoice.id),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.create_grouped_invoice(
  text, text, text, date, text, text, jsonb, date) from public;
grant execute on function public.create_grouped_invoice(
  text, text, text, date, text, text, jsonb, date) to authenticated;
