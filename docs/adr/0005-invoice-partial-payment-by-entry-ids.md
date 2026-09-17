---
status: accepted
---

# Pago parcial de facturas por período: unificar en `entry_ids` (cobertura)

Ver los términos **Billing Status** y **Pago a contractor / Cobertura** en
[CONTEXT.md](../../CONTEXT.md).

Se quiere pagar una factura **por período** (mes/semana), igual que hoy se pagan las horas
invoice-less (overage / SP internal) con el picker Total / By month / By week.

## Contexto

Hoy hay **dos** modelos de pago:
- **Bajo factura** (`register_contractor_payment`, mig 0040): se paga la **línea entera** de
  un contractor (`invoice_contractors`). El pago deja `payments.entry_ids` NULL; "paid" es un
  estado de la fila (payment_id/supplier#/fecha), y la factura flipea a **Paid** cuando ninguna
  fila hija queda sin pagar. El supplier invoice number es obligatorio y vive en la fila.
- **Invoice-less** (`createInvoicelessPayment`, mig 0035): se paga un **subconjunto** de horas
  por `entry_ids` (el bucket de período elegido), sin supplier#. El trigger
  `payments_entry_ids_no_overlap` (mig 0037) evita el doble-pago y **rechaza** horas que ya
  están en `invoices.entry_ids`.

Pagar una factura por período exige cubrir un **subconjunto** de las horas de una línea, cosa
que el modelo "línea entera" no permite.

## Decisión

Unificar el pago de factura sobre el **mismo mecanismo de `entry_ids`** que el invoice-less:
- Un pago **bajo factura** registra los `entry_ids` que cubre (el período elegido), más un
  **supplier invoice number por pago** (columna nueva en `payments`, obligatoria).
- El "paid" de una línea de contractor pasa a ser **derivado por cobertura** (todas sus horas
  cubiertas), no un booleano en la fila. La factura llega a **Paid** cuando **todas** las horas
  de todos sus contractors están cubiertas.
- El modal de pago se reemplaza por el **mismo picker** que overage/SP internal (Total / By
  month / By week + selección por hora). "Total" cubre el caso de un solo pago.
- Los pagos parciales quedan **visibles/auditables** incluso cuando la factura ya es **Paid**.

Consecuencia sobre el trigger anti-solape (0037): como los pagos bajo factura ahora **sí**
llevan `entry_ids`, el trigger debe permitir que un pago cubra horas de **su propia** factura
(`payments.invoice_id`), sin dejar de bloquear el doble-pago entre pagos ni que un pago
invoice-less cubra horas ya facturadas.

## Considered Options

- **Pre-partir la línea por período en sub-filas `invoice_contractors`** — mantiene "1 fila =
  1 pago" pero multiplica filas, cambia la forma de los datos y el árbol de Payments, y duplica
  un segundo modelo de partición además del `entry_ids` que ya existe. Descartada.
- **No pedir supplier# en los pagos parciales** (como invoice-less) — perdería la traza contable
  que Billing hoy exige por pago a contractor. Descartada: el usuario lo quiere obligatorio por
  pago.

## Consequences

- Cambio de DB serio y **destructivo/gated**: columna `supplier_invoice_number` en `payments`,
  reescritura de `register_contractor_payment` (acepta subconjunto de `entry_ids` + supplier#,
  valida cobertura ⊆ línea y no-solape, flipea a Paid por cobertura total) y ajuste del trigger
  `payments_entry_ids_no_overlap`. Requiere aprobación humana antes de aplicar.
- "Paid" deja de ser un booleano por línea y pasa a **derivarse** por cobertura en todos lados
  (grilla, KPIs, freeze). Las columnas de pago en `invoice_contractors` quedan vestigiales para
  el caso parcial.
- Un solo flujo de pago para todo Payments (factura + invoice-less).
- **Fuera de alcance**: el recorte de facturas por Stage en Payments (las facturas siguen
  atómicas para el Filtro de Stage). Esta feature lo habilitaría técnicamente, pero se decidió
  no hacerlo.
