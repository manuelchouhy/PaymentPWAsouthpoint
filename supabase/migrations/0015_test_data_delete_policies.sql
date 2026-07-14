-- Playwright E2E (Prompt R2): cleanupInvoice() necesita poder borrar la
-- cadena de una invoice de prueba (payments/collections/invoice_status_history
-- /invoices). Sin policy de DELETE, RLS bloquea el borrado en silencio (0 filas
-- afectadas, sin error) y deja residuos de test en la base real — ya pasó una
-- vez y contaminó billing status de time entries reales de empleados.
-- Acotado a supplier_invoice_number LIKE 'PW-TEST-%' para no abrir DELETE
-- general sobre facturas reales.

drop policy if exists "auth delete test invoices" on public.invoices;
create policy "auth delete test invoices" on public.invoices
  for delete to authenticated
  using (supplier_invoice_number like 'PW-TEST-%');

drop policy if exists "auth delete test invoice_status_history" on public.invoice_status_history;
create policy "auth delete test invoice_status_history" on public.invoice_status_history
  for delete to authenticated
  using (
    invoice_id in (select id from public.invoices where supplier_invoice_number like 'PW-TEST-%')
  );

drop policy if exists "auth delete test collections" on public.collections;
create policy "auth delete test collections" on public.collections
  for delete to authenticated
  using (
    invoice_id in (select id from public.invoices where supplier_invoice_number like 'PW-TEST-%')
  );

drop policy if exists "auth delete test payments" on public.payments;
create policy "auth delete test payments" on public.payments
  for delete to authenticated
  using (
    invoice_id in (select id from public.invoices where supplier_invoice_number like 'PW-TEST-%')
  );
