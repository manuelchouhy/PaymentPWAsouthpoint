-- Policy de DELETE para clients bajo RLS.
--
-- La 0017 habilitó RLS en public.clients con policies de read/insert/update pero
-- NINGUNA de delete ("nadie borra"). Con RLS activa y sin policy de delete,
-- supabase.from('clients').delete() matchea 0 filas y devuelve { error: null }:
-- un borrado que no-opea EN SILENCIO (la UI reportaba "Client deleted" y el
-- cliente reaparecía al recargar). La 0015 ya documentaba ese mismo patrón.
--
-- Se agrega la policy con el mismo alcance que insert/update (to authenticated,
-- using true): igual que en toda la app, el control fino lo hace el gate de
-- permiso en el cliente (para borrar: `clients.delete`, sólo ADMIN) + la
-- confirmación de dos pasos, NO la RLS.
--
-- LIMITACIÓN CONOCIDA (open item): `using (true)` deja que cualquier usuario
-- autenticado (aunque no vea el botón) borre vía API directa, más amplio que el
-- gate ADMIN de la app. Es el mismo patrón permisivo que insert/update; endurecer
-- esto pide RLS por rol a nivel DB (app-wide), fuera de este slice.
--
-- FK: la única que referencia clients es projects.client_id, ON DELETE SET NULL
-- (ver 0018/0030): borrar un cliente deja sus proyectos sin cliente, no se borran
-- en cascada. OJO: el MSA vive en project_documents (subject_type='msa') SIN FK a
-- clients y en el bucket 'client-msa'; esas filas/archivos NO se borran (historial
-- versionado, ver recordClientMsaVersion) → quedan huérfanos (open item).
drop policy if exists "auth delete clients" on public.clients;
create policy "auth delete clients" on public.clients
  for delete to authenticated using (true);
