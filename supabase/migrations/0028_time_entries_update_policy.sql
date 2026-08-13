-- time_entries quedó con RLS y solo políticas de SELECT: el triage de Entries
-- (setEntriesAllocation) hacía un UPDATE que PostgREST filtraba a cero filas y
-- devolvía 200, así que la clasificación "funcionaba" en pantalla y se perdía
-- al recargar. Mismo descuido que 0023 y 0025 tuvieron que corregir para
-- project_tasks y project_stages.
--
-- Solo `authenticated` (a diferencia del SELECT, que también permite anon):
-- clasificar horas define quién las paga, no es lectura pública.
drop policy if exists "auth update time_entries" on public.time_entries;
create policy "auth update time_entries" on public.time_entries
  for update to authenticated using (true) with check (true);
