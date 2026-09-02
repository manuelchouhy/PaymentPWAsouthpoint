-- 0039 — Fundación del modelo de factura AGRUPADA multi-contractor (en horas).
--
-- Contexto (PRD .scratch/billing-project-grouping): una factura pasa a cubrir UN
-- cliente + UN proyecto + UNA semana (dom→sáb) y agrupa a VARIOS contractors, en
-- vez de estar atada a un solo contractor. El detalle por-contractor (sus horas y,
-- al pagar, su supplier invoice number) vive en una tabla hija.
--
-- ESTA migración es la FUNDACIÓN aditiva (slice 02): crea la tabla hija, agrega las
-- columnas de la unidad facturable + el SP invoice number, y da la RPC atómica de
-- emisión agrupada. NO dropea columnas de plata, NO quita el índice único de pagos
-- ni reescribe register_contractor_payment: ese rework (pago por contractor) va en
-- el slice de Payments para no romper el flujo actual.
--
-- invoices.entry_ids se MANTIENE como la UNIÓN de las horas de todos los
-- contractors de la factura (denormalizado): el trigger anti-doble-pago 0037 y el
-- entry-freeze leen invoices.entry_ids, así que siguen funcionando sin reescritura.
--
-- Esta migración es DDL PURO (reproducible en cualquier env). El limpiado one-time
-- de las filas de QA del slice anterior NO va acá: un DELETE incondicional en una
-- migración es peligroso (sp_internal→Payments entró a prod el 2026-09-01; podría
-- haber pagos reales). Ese borrado se corre aparte, scopeado a esas filas y con
-- aprobación humana, no como parte del schema.

-- 1) invoices: SP invoice number (SouthPoint → cliente) + unidad facturable.
--    Nullable: el createInvoice viejo (single-contractor) sigue existiendo hasta
--    el slice de emisión, así que no se puede exigir estas columnas todavía.
alter table public.invoices
  add column if not exists sp_invoice_number text,
  add column if not exists project           text,
  add column if not exists client            text,
  add column if not exists week_start        date;

comment on column public.invoices.sp_invoice_number is
  'Número de factura de SouthPoint al cliente (SP invoice number), uno por factura '
  'agrupada, cargado a mano al emitir. Distinto del supplier_invoice_number '
  '(número del proveedor), que pasa a invoice_contractors al pagar.';

-- La factura agrupada es "sin plata" y ya no ata un solo contractor: al emitir NO
-- se cargan supplier_invoice_number/invoice_date/total_amount/user_name (el
-- supplier# y la fecha pasan a invoice_contractors al pagar; el total se deriva en
-- horas). Esas columnas eran NOT NULL sin default, así que la emisión agrupada
-- fallaría con 23502; se relajan a nullable. El createInvoice viejo las sigue
-- seteando, así que no lo rompe (drop de estas columnas: slice de Payments).
alter table public.invoices
  alter column supplier_invoice_number drop not null,
  alter column invoice_date           drop not null,
  alter column total_amount           drop not null,
  alter column user_name              drop not null;

-- Unicidad ATÓMICA del SP invoice number: la columna es nueva (todas las filas
-- preexistentes la tienen NULL), así que un índice único PARCIAL (where not null)
-- es seguro y no arrastra los duplicados históricos (esos están en
-- supplier_invoice_number, que sí sigue sin constraint único). Enforcement en BD:
-- dos emisiones concurrentes con el mismo SP number no pueden pasar ambas (el
-- EXISTS del RPC es sólo un pre-chequeo para dar un error legible en el caso común).
create unique index if not exists invoices_sp_invoice_number_unique
  on public.invoices (sp_invoice_number)
  where sp_invoice_number is not null;

-- 2) Tabla hija: una fila por contractor de la factura. entry_ids/hours se cargan
--    al emitir; supplier_invoice_number/payment_date/payment_id al pagar (slice de
--    Payments). La factura está totalmente pagada cuando todas sus filas tienen
--    payment_id.
create table if not exists public.invoice_contractors (
  id                       bigint generated always as identity primary key,
  invoice_id               bigint not null references public.invoices (id) on delete cascade,
  contractor               text   not null,
  entry_ids                bigint[] not null default '{}',
  hours                    numeric  not null default 0,
  supplier_invoice_number  text,
  payment_date             date,
  payment_id               bigint references public.payments (id),
  created_at               timestamptz not null default now()
);

create index if not exists invoice_contractors_invoice_idx
  on public.invoice_contractors (invoice_id);
create index if not exists invoice_contractors_payment_idx
  on public.invoice_contractors (payment_id);

-- RLS: mismo criterio que invoices (authenticated read/insert/update; delete sólo
-- para facturas de test PW-TEST-%, vía el padre).
alter table public.invoice_contractors enable row level security;

drop policy if exists "auth read invoice_contractors" on public.invoice_contractors;
create policy "auth read invoice_contractors" on public.invoice_contractors
  for select to authenticated using (true);

drop policy if exists "auth insert invoice_contractors" on public.invoice_contractors;
create policy "auth insert invoice_contractors" on public.invoice_contractors
  for insert to authenticated with check (true);

drop policy if exists "auth update invoice_contractors" on public.invoice_contractors;
create policy "auth update invoice_contractors" on public.invoice_contractors
  for update to authenticated using (true) with check (true);

-- Las facturas agrupadas dejan supplier_invoice_number NULL (su número va en
-- sp_invoice_number), así que el cleanup de QA se identifica por PW-TEST-% en
-- CUALQUIERA de los dos números.
drop policy if exists "auth delete test invoice_contractors" on public.invoice_contractors;
create policy "auth delete test invoice_contractors" on public.invoice_contractors
  for delete to authenticated using (
    invoice_id in (
      select id from public.invoices
      where supplier_invoice_number like 'PW-TEST-%'
         or sp_invoice_number like 'PW-TEST-%'
    )
  );

-- Extiende la policy de delete de test de invoices (0015, keyed sólo en
-- supplier_invoice_number) para alcanzar también las facturas agrupadas de QA,
-- que sólo tienen sp_invoice_number. Sin esto, el cleanup de Playwright de una
-- factura agrupada de test sería no-op por RLS y dejaría residuo en prod.
drop policy if exists "auth delete test invoices" on public.invoices;
create policy "auth delete test invoices" on public.invoices
  for delete to authenticated using (
    supplier_invoice_number like 'PW-TEST-%'
    or sp_invoice_number like 'PW-TEST-%'
  );

-- 3) (Diferido al slice de Payments) El índice único payments_invoice_id_unique
--    (un pago por factura) se quita RECIÉN cuando entre el pago por-contractor
--    (varios pagos por factura). Esta fundación NO inserta pagos, así que quitarlo
--    ahora sólo sacaría un backstop de doble-pago sin su reemplazo. Se mantiene.

-- 4) Emisión atómica de la factura agrupada. SECURITY INVOKER: corre con la RLS
--    del usuario (las policies de insert de invoices/invoice_contractors aplican).
--    Dedup del SP invoice number en la función (no hay constraint único: los
--    números históricos del supplier tienen duplicados sin migrar).
create or replace function public.create_grouped_invoice(
  p_sp_invoice_number text,
  p_project           text,
  p_client            text,
  p_week_start        date,
  p_notes             text,
  p_created_by        text,
  p_contractors       jsonb
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

  insert into invoices (sp_invoice_number, project, client, week_start, notes,
                        entry_ids, status, created_by)
  values (btrim(p_sp_invoice_number), p_project, p_client, p_week_start, p_notes,
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
  text, text, text, date, text, text, jsonb) from public;
grant execute on function public.create_grouped_invoice(
  text, text, text, date, text, text, jsonb) to authenticated;
