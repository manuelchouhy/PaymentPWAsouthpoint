---
status: accepted
---

# Client Summary: Budget es el estimado del proyecto; la vista semanal es a granularidad de proyecto

En Client Summary el **Budget** de cada fila es el **estimado del proyecto** (estimado
de la SOW + change requests aprobados, vía `effectiveBudgetHours`), un total que no
cambia semana a semana y que **crece cuando se aprueba un change request**. Las filas
por semana muestran el consumido de esa semana más el **acumulado** y el **remanente**
(Budget − consumido acumulado); el **Overage** aparece cuando ese acumulado supera el
Budget y no se absorbe con un CR.

## Considered Options

- **Fila por (SOW, semana)** — descartada: las time entries se atan al **proyecto**
  (por nombre / `zohoProjectId`), **no al SOW ni al stage**. Con proyectos multi-stage
  (varios SOW) no hay forma, con los datos actuales, de saber a qué SOW pertenece cada
  hora. Elegir esta opción exigiría rediseñar cómo se cargan/atan las horas en Zoho.
- **Budget como cuota semanal** — descartada: no existe tal dato; el estimado vive a
  nivel proyecto.

## Consequences

- La fila por (proyecto, semana) suma **todos** los SOW de un proyecto multi-stage; la
  columna SOW los muestra coma-separados. Es la misma limitación que ya tenía el
  drill-down de Client Summary (`hoursByProject` agrupa por `entry.project`).
- Consumed cuenta solo horas `bill_to_client` **aprobadas**; Overage cuenta horas
  `overage` aprobadas. Consistente con Billing y con el resto de la app.
