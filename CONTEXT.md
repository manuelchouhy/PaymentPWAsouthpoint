# Payments PWA (SouthPoint)

Aplicación interna para clasificar horas cargadas, facturarlas a clientes y
seguir cobros y pagos a contractors. Este glosario fija el lenguaje del dominio;
no describe implementación.

## Language

### Billing

**To bill**:
Estado de una hora aprobada y clasificada `bill_to_client` que todavía **no
entró a ninguna factura**. Es el contenido de la grilla "Ready to bill". No es un
Billing Status: vive antes del ciclo de factura.
_Avoid_: Pending (reservado para el Billing Status), unbilled.

**Billing Status**:
Estado de una factura dentro de su ciclo de vida: **Pending → Invoiced →
Collected → Paid**. Aplica a una factura ya creada, no a horas sueltas.
_Avoid_: usar "Pending" para referirse a horas "to bill" (son cosas distintas).

**Budget**:
Horas **estimadas** de un proyecto: el estimado de la SOW más los change requests
aprobados. Es un total del proyecto (no un valor por semana) y **crece cuando se
aprueba un change request**. En código lo calcula `effectiveBudgetHours(baseBudget,
changeRequests)`.
_Avoid_: tratar el Budget como una cuota semanal.

**Base budget (estimado del SOW)** vs **Change request**:
Son dos cosas distintas y no se confunden.
- **Editar el base budget** = **corregir/cargar el estimado del SOW** cuando está
  mal o falta (ej. el SOW decía 150 y eran 200; un proyecto sincronizado de Zoho
  llegó sin budget). Es un **arreglo de un dato**, no un cambio de lo pactado: **no
  lleva aprobación**, solo queda auditado.
- **Change request** = ampliar lo **pactado** con el cliente (que pagará el
  excedente). Es un compromiso comercial nuevo: nace `pending` y **requiere
  aprobación** antes de sumar al Budget.
_Avoid_: usar el edit del base para meter una ampliación de alcance (eso es un
change request); usar un change request para corregir un base mal cargado.

**SP internal** (allocation `sp_internal`):
Horas de **proyectos internos de la empresa** (SouthPoint), no de un cliente. Se
pagan al contractor pero **no se facturan a nadie**. Por naturaleza viven en
proyectos del grupo **SouthPoint Internal**; un proyecto de cliente real no tiene
horas `sp_internal`. En Client Summary cuentan como **Consumed** de la fila
SouthPoint Internal (ver "Consumed"). Ver también el pago sin factura en Payments.
_Avoid_: pensar que una hora `sp_internal` pueda pertenecer a un cliente real.

**Consumed**:
Horas de trabajo **consumidas por el proyecto** en Client Summary. La allocation
que cuenta depende del cliente:
- clientes con Budget → horas `bill_to_client` **aprobadas** (consumen el Budget;
  alimentan `cumulative` y `remaining`).
- **SouthPoint Internal** (sin Budget) → horas `sp_internal` **aprobadas** (costo
  interno; no hay Budget contra qué medir, así que **Remaining y Overage quedan en
  blanco** en esa fila).
Un mismo cliente nunca mezcla ambas: `bill_to_client` va a clientes reales y
`sp_internal` a SouthPoint Internal.
_Avoid_: leer "Consumed" como "siempre facturable"; para SouthPoint Internal es
costo interno, no facturación.

**Overage**:
Horas por encima de lo contratado (allocation `overage`); se pagan al contractor,
no se facturan al cliente. Nace cuando el **consumido acumulado** (horas
`bill_to_client` aprobadas) supera el **Budget** y ese excedente NO se absorbe con
un change request: entonces se clasifica como `overage` en vez de subir el Budget.
No aplica a SouthPoint Internal (no tiene Budget que superar).

**Week**:
La semana física de facturación, **domingo → sábado**, identificada por el domingo
que la inicia (`weekStart`) y numerada por ese domingo (`sundayWeek`, 1..54, tipo
Excel WEEKNUM). Una semana pertenece al **año de su domingo**, así que se rotula
siempre con el año (`WEEK - 35 · 2026`) para no fusionar la misma semana de años
distintos.
_Avoid_: la semana ISO (lunes–domingo); referirse a una semana por su número sin
el año.

**Filtro de semana**:
Dos filtros con el mismo rótulo "Week" pero distinta semántica, a propósito:
- **Navegador de semana** (Entries): filtra por la **Week física exacta** (mismo
  `weekStart`, año incluido). Es el canónico.
- **Filtro numérico "W35"** (Payments): atajo **year-blind** sobre el número de
  `sundayWeek` — W35/2025 y W35/2026 caen juntas. Limitación conocida y aceptada
  en Payments; no es el comportamiento del navegador.

### Supplier Contracts

**Contractor / Supplier**:
El **proveedor** de horas (un contractor). El módulo se llama "Supplier Contracts"
y la columna DB es `supplier_name`, pero el **rótulo visible es "Contractor Name"**
(alineado con el spec del negocio). Son el mismo concepto: en UI decimos
"Contractor", en el modelo de datos quedó "supplier".

**Rol** (`role`):
Rol del contractor en el contrato (texto libre, ej. "Developer", "QA"). Campo del
contrato, no un catálogo cerrado. En la UI el label visible es **"Role"** (inglés,
como el resto de la interfaz); la columna DB es `role`.

### Diseño

**Mockup** (`.scratch/pantallas-nuevas-mockup.html`):
Fuente de verdad **solo del diseño** (colores, tokens, layout, tipografía). No es
fuente de verdad de comportamiento ni de semántica de dominio.

## Flagged ambiguities

- **"Pending" está sobrecargado.** El label de fila "to bill" y el Billing Status
  "Pending" compartían la clase CSS `badge--pending` (gris sólido). Resuelto: "to
  bill" usa su propia clase `badge--tobill` (ámbar, como el `.pill.pend` del
  mockup); "Pending" sigue siendo exclusivamente el Billing Status.
- **Ámbar sobrecargado en badges**, a propósito: `badge--invoiced` (ámbar sólido =
  ya facturado) vs `badge--tobill` / `badge--alloc-overage` (ámbar translúcido =
  sin facturar / overage). No conviven en la misma tabla, así que sólido-vs-
  translúcido alcanza para distinguirlos; se acepta la cercanía por fidelidad al
  mockup.

## Example dialogue

> **Dev:** ¿Un badge "to bill" es lo mismo que Billing Status "Pending"?
> **Experto:** No. "To bill" son horas que todavía no metí en ninguna factura.
> "Pending" es una factura que ya existe pero que aún no marqué como enviada.
> **Dev:** Entonces una hora "to bill" no tiene Billing Status todavía.
> **Experto:** Exacto. Recién cuando la mando a facturar nace la factura, y ahí
> empieza el ciclo Pending → Invoiced → Collected → Paid.
