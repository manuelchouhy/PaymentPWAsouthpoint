-- Bug reportado por Martin (regresión): "Audit Log global vacío pese a
-- acciones reales". Reproducido: logAudit() falla en silencio (fire-and-
-- forget, solo console.warn) con "new row violates row-level security
-- policy for table audit_log" — la policy de INSERT en producción no
-- coincide con la de schema_completo.sql (for insert to authenticated
-- with check (true)). Se reafirma explícitamente acá para que quede
-- corregida sin depender de a qué se desvió en el dashboard.

drop policy if exists "auth insert audit_log" on public.audit_log;
create policy "auth insert audit_log" on public.audit_log
  for insert to authenticated with check (true);

drop policy if exists "auth read audit_log" on public.audit_log;
create policy "auth read audit_log" on public.audit_log
  for select to authenticated using (true);
