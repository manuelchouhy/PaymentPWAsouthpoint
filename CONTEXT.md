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

**Overage**:
Horas por encima de lo contratado (allocation `overage`); se pagan al contractor,
no se facturan al cliente.

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
