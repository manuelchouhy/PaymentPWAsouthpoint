-- =============================================================================
-- Fix: project_tasks quedó insert-only por descuido en 0020 — sin update ni
-- delete, una task mal tipeada no se podía corregir nunca. Se agrega update
-- (delete sigue sin existir, mismo patrón "nadie borra" del resto de la app).
-- =============================================================================

drop policy if exists "auth update project_tasks" on public.project_tasks;
create policy "auth update project_tasks" on public.project_tasks
  for update to authenticated using (true) with check (true);
