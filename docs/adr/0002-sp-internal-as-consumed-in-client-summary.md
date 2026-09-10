---
status: accepted
---

# Client Summary cuenta las horas `sp_internal` como Consumed en SouthPoint Internal

Extiende el [ADR-0001](0001-client-summary-budget-and-weekly-granularity.md), cuya
consecuencia decía "Consumed cuenta solo horas `bill_to_client` aprobadas".

Las horas con allocation `sp_internal` son trabajo en **proyectos internos de la
empresa** (grupo SouthPoint Internal): se pagan al contractor pero no se facturan a
nadie. Antes el motor de Client Summary las filtraba (solo procesaba `bill_to_client`
y `overage`), así que la fila del cliente **SouthPoint Internal** aparecía casi vacía
pese a tener cientos de horas cargadas.

Decisión: en Client Summary, `sp_internal` cuenta como **Consumed**, con el mismo
trato de status que `bill_to_client`:

- `sp_internal` **Approved** → Consumed.
- `sp_internal` **Pending** → columna Pending (no suma a Consumed).
- SouthPoint Internal no tiene Budget, así que **Remaining y Overage quedan en blanco**
  en su fila (no hay contra qué medir).
- Se cuenta en la **fila del cliente que resuelve el proyecto** (Opción A, sin guarda):
  como `sp_internal` es por naturaleza trabajo interno, todos esos proyectos resuelven
  a SouthPoint Internal; un proyecto de cliente real no tiene horas `sp_internal`.
- Entra también a los **totales de portfolio y a los 2 gráficos** (Opción A: incluir en
  todo), igual que cualquier hora consumida.

## Considered Options

- **Columna/sección "Internal" separada de Consumed** — descartada: más UI y más código;
  el usuario prefirió reusar Consumed y ampliar su definición en `CONTEXT.md`.
- **Guarda por cliente (contar `sp_internal` solo si el cliente resuelto es SouthPoint
  Internal)** — descartada: protege contra un caso imposible por dominio (un cliente
  real no tiene horas `sp_internal`) y metería el cliente interno hardcodeado en el motor.
- **Excluir `sp_internal` de gráficos/totales de portfolio** — descartada: rompería la
  consistencia "Consumed es Consumed en todos lados" y exigiría separar consumed-interno
  de consumed-facturable; los gráficos ya respetan filtros para aislar SouthPoint Internal.

## Consequences

- El "total Consumed" de portfolio mezcla horas facturables (clientes) + horas internas
  (SouthPoint Internal). Es literalmente cierto (hay horas sin budget); si molesta, se
  filtra por cliente.
- En la vista sin filtro, el Consumed total puede verse mayor que el Budget total, porque
  el consumo interno no tiene budget que lo respalde. El donut/Remaining ya trata bien los
  proyectos sin budget (suman a Consumed, 0 a Remaining).
- Las horas **sin clasificar** (allocation `null`) siguen fuera de Client Summary; no son
  `sp_internal`.
- Horas `sp_internal` sobre un nombre de proyecto que no existe en `projects` (ej. las 14h
  de "DOMO + Zoho Dashboard Reports") siguen sin aparecer: el motor arma filas por proyecto
  existente. Se resuelve aparte arreglando el dato.
