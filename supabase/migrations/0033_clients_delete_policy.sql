-- Policy de DELETE para clients bajo RLS.
--
-- La 0017 habilitó RLS en public.clients con policies de read/insert/update pero
-- NINGUNA de delete ("nadie borra"). Con RLS activa y sin policy de delete,
-- supabase.from('clients').delete() matchea 0 filas y devuelve { error: null }:
-- un borrado que no-opea EN SILENCIO (la UI reportaba "Client deleted" y el
-- cliente reaparecía al recargar). La 0015 ya documentaba ese mismo patrón.
--
-- Se agrega la policy con el mismo alcance que insert/update (to authenticated,
-- using true): el control fino del borrado lo hace la app —gate por permiso
-- clients.edit + confirmación de dos pasos—, no la RLS.
--
-- FK: la única que referencia clients es projects.client_id, ON DELETE SET NULL
-- (ver 0018/0030), así que borrar un cliente deja sus proyectos sin cliente; no
-- se borran en cascada.
drop policy if exists "auth delete clients" on public.clients;
create policy "auth delete clients" on public.clients
  for delete to authenticated using (true);
