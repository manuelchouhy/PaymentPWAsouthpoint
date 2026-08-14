-- =============================================================================
-- Endurece el UPDATE de time_entries que abrió 0028.
-- =============================================================================
-- 0028 destrabó el triage de horas, pero con `using (true) with check (true)`:
-- cualquier usuario logueado podía cambiar allocation, hours, status o
-- user_name de CUALQUIER fila pegándole directo a PostgREST.
--
-- OJO — lo que esta migración NO cierra: la policy sigue siendo `to
-- authenticated` sin predicado de rol, así que un usuario Finance o Contractor
-- (a quienes `permissions.js` excluye de `entries.allocate`, y que no ven el
-- botón Apply) todavía puede hacer PATCH de `allocation` sobre una fila no
-- facturada con su propio JWT. Meter el rol en la policy hoy dejaría a todos
-- afuera mientras `permissions_enforced` siga en false y los role_mappings
-- estén incompletos; va cuando se active esa bandera.
--
-- Peor: el invariante "una hora ya facturada no se reclasifica" vivía sólo en
-- el cliente (el checkbox deshabilitado y el chequeo de setEntriesAllocation).
-- La lección de 0028 fue justamente que una garantía que sólo existe en el
-- cliente no es una garantía. Acá baja a la base.
--
-- Dos candados independientes:
--   1) Privilegio por columna: desde el cliente sólo se puede escribir
--      `allocation`. hours/status/user_name los sigue escribiendo el sync
--      (Edge Function `sync-time-logs`, service_role, que no pasa por RLS).
--   2) Policy: la fila no puede estar en ninguna factura.
--
-- El chequeo va en una función SECURITY DEFINER en vez de una subconsulta
-- directa: dentro de una policy, un `select ... from invoices` se evalúa con
-- las RLS del usuario, así que si mañana se restringe la lectura de invoices,
-- las facturas invisibles dejarían de congelar nada y el candado se abriría
-- solo, en silencio.
--
-- Cómo correrlo: Supabase → SQL Editor → pegar y ejecutar.
-- =============================================================================

-- 1) Sólo `allocation` es escribible desde el cliente.
revoke update on public.time_entries from authenticated;
grant  update (allocation) on public.time_entries to authenticated;

-- 2) ¿La entry ya salió en una factura?
--    `invoices.status` sólo toma Invoiced/Collected/Paid (0003): existir en una
--    factura ya significa congelada, no hace falta mirar el status.
--
--    La función se llama una vez por fila y un "select all" son cientos de
--    filas en una sola sentencia, así que el chequeo tiene que ir por índice:
--    `@>` (containment) usa el GIN de abajo, `= any(entry_ids)` obliga a un
--    scan secuencial de invoices por cada fila.
create index if not exists invoices_entry_ids_gin
  on public.invoices using gin (entry_ids);

create or replace function public.entry_is_invoiced(p_entry_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.invoices i where i.entry_ids @> array[p_entry_id]
  );
$$;

-- El revoke a PUBLIC no alcanza: Supabase tiene default privileges que le dan
-- EXECUTE a anon y authenticated sobre toda función nueva del schema public, y
-- ese es un grant explícito aparte. Sin el revoke a anon, cualquiera sin
-- loguearse puede preguntar por /rest/v1/rpc/entry_is_invoiced si una entry
-- está facturada. authenticated sí lo necesita: la expresión de una policy se
-- evalúa con los permisos del usuario que consulta.
revoke all     on function public.entry_is_invoiced(bigint) from public;
revoke execute on function public.entry_is_invoiced(bigint) from anon;
grant  execute on function public.entry_is_invoiced(bigint) to authenticated;

-- `with check` es hoy redundante con `using` (el grant por columna impide
-- mover `id`), pero se deja puesto a propósito: si mañana alguien amplía el
-- grant, la ausencia del check sería un agujero silencioso y el costo extra es
-- una probada al índice.
drop policy if exists "auth update time_entries" on public.time_entries;
create policy "auth update time_entries" on public.time_entries
  for update to authenticated
  using      (not public.entry_is_invoiced(id))
  with check (not public.entry_is_invoiced(id));
