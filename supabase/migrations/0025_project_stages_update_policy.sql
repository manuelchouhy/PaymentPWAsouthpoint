-- =============================================================================
-- Fix: project_stages (0024) quedó insert-only, mismo descuido que 0023 tuvo
-- que corregir para project_tasks — un stage_name o sow_number mal tipeado
-- no se podía corregir nunca. Se agrega update (delete sigue sin existir,
-- mismo patrón "nadie borra" del resto de la app).
-- =============================================================================

drop policy if exists "auth update project_stages" on public.project_stages;
create policy "auth update project_stages" on public.project_stages
  for update to authenticated using (true) with check (true);
