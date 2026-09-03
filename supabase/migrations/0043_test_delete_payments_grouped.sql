-- 0043 — Fix de la policy de DELETE de pagos de TEST para el modelo agrupado.
--
-- Contexto: 0039 extendió las policies de delete de invoices e invoice_contractors
-- para alcanzar las facturas de QA agrupadas (que dejan supplier_invoice_number NULL
-- y llevan el número en sp_invoice_number). Pero la policy "auth delete test payments"
-- quedó keyeada SÓLO en el supplier_invoice_number de la factura padre, así que el
-- cleanup de Playwright de una factura AGRUPADA no podía borrar sus pagos por-contractor
-- (RLS los filtraba silenciosamente) → luego el delete de la factura fallaba por la FK
-- payments.invoice_id y quedaba residuo (invoice + payments) en prod.
--
-- Este fix alinea la policy de payments con las de invoices/invoice_contractors:
-- alcanza a la factura de test por CUALQUIERA de los dos números. Sólo afecta el
-- DELETE de filas cuya factura padre es de QA (PW-TEST-%); no toca datos reales.

drop policy if exists "auth delete test payments" on public.payments;
create policy "auth delete test payments" on public.payments
  for delete to authenticated using (
    invoice_id in (
      select id from public.invoices
      where supplier_invoice_number like 'PW-TEST-%'
         or sp_invoice_number like 'PW-TEST-%'
    )
  );
