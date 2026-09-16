---
status: accepted
---

# El filtro de Stage recalcula Client Summary al stage (Budget y Consumed)

Ver el término **Filtro de Stage** y **Stage** en [CONTEXT.md](../../CONTEXT.md), y
el budget del stage activo en [ADR 0001](0001-client-summary-budget-and-weekly-granularity.md).

Se agrega el filtro de Stage a todas las páginas que miran horas o proyectos. En las
páginas de horas (Entries, Payments, Dashboard, Billing) y en Projects el filtro sólo
**acota qué filas se ven** y no cambia ningún número. En **Client Summary** se decidió
lo contrario: al elegir un Stage, la fila **se recalcula** al stage.

## Contexto

Hoy la fila de Client Summary ya tiene una inconsistencia conocida (open item): el
**Budget** se mide contra el **stage activo** (`resolveProjectBudget` → `activeBudget`,
ADR 0001), pero el **Consumed** suma las horas de **todo el proyecto** (todos los
stages), atadas al proyecto por nombre, sin atribución task→stage. O sea: consumo total
medido contra el budget de un solo stage. El motor (`clientSummaryWeekly.js`) no carga
la membresía task→stage.

## Decisión

En Client Summary, con uno o varios Stages elegidos, la fila (y su grilla semanal,
Remaining, cumulative y los gráficos) se recalcula para reflejar **sólo** ese/esos
Stage(s):

- **Budget** = suma del `budget_hours` de los Stage(s) elegidos (no el del proyecto
  entero).
- **Consumed** = sólo horas de Tasks **dentro** de esos Stages, vía atribución
  task→stage (misma membresía que usa Billing).
- **Remaining / semanal / gráficos** = derivados de ese subconjunto.
- Proyectos/clientes **sin** un Stage elegido desaparecen de la vista (filtro de fila).

Esto obliga a traer la membresía task→stage al motor de Client Summary, que hoy no la
tiene. Como efecto colateral, para la **vista filtrada** cierra la inconsistencia
Budget-stage-activo vs Consumed-total: al recortar ambos al mismo stage, el número es
honesto.

## Considered Options

- **Filtro de fila (como en las otras páginas)** — el Stage sólo acotaría qué clientes
  aparecen, sin tocar Budget ni Consumed. Descartada: en una vista cuyo eje es
  Budget-vs-Consumed, un filtro que no cambia esos números es el más débil de todos y
  deja en pie la inconsistencia; el usuario pidió explícitamente que "en vez del budget
  del proyecto entero aparezca el del stage".
- **Recalcular sólo el Budget, dejar Consumed total** — más simple, pero deja el
  Remaining sin sentido (budget de un stage menos consumo de todo el proyecto).
  Descartada por incoherente.

## Consequences

- El filtro de Stage es el **único** filtro de la app que **reescribe los números** de
  una fila en vez de sólo acotar filas. Documentado en CONTEXT.md para que no sorprenda.
- El motor `clientSummaryWeekly.js` pasa a depender de la **membresía task→stage**
  (nuevo input), no sólo de los budgets por stage.
- La inconsistencia Budget-vs-Consumed queda resuelta **sólo en la vista filtrada por
  stage**; sin filtro, la fila sigue mostrando Budget del stage activo vs Consumed total
  (el open item de la vista sin filtrar sigue abierto, fuera de alcance de este trabajo).
- Multi-stage seleccionado dentro de un proyecto: Budget y Consumed son la **suma** de
  los stages elegidos.
