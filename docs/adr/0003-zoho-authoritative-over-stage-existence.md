---
status: accepted
---

# Zoho es autoritativo sobre la existencia de un Stage (incluye su eliminación)

Ver el término **Stage** en [CONTEXT.md](../../CONTEXT.md). Un Stage es una etapa
interna de un proyecto que la app modela en `project_stages`; su **existencia,
nombre y estructura vienen de Zoho** (una Task de Zoho llamada "Stage N" con sus
subtareas), mientras que el **budget de horas** y **cuál stage está activo** son
datos del Desk (se cargan a mano).

El resto de la app sigue el patrón **"nobody deletes"**: no hay policies de borrado
y las tablas solo crecen (ver `project_stages` sin delete policy — 0024/0025, y la
nota en varios data-layers). Pero si el Stage se sincroniza desde Zoho y Zoho es la
fuente de verdad de qué stages existen, un Stage que **desaparece de Zoho** ya no
existe — mantener su fila en el Desk mostraría un stage fantasma (con budget) que no
está en ningún lado.

Decisión: para los Stages **sincronizados**, **Zoho manda también sobre el borrado**.
Si un "Stage N" se elimina en Zoho, el sync **borra** ese `project_stages` del Desk,
incluido su `budget_hours` cargado a mano. Es una **excepción acotada** al patrón
"nobody deletes", limitada a stages sincronizados de Zoho.

El riesgo de perder un budget cargado a mano se acota por dominio: **un stage en
curso (activo) no se borra en Zoho**, así que en la práctica solo se borran stages
sin trabajo vivo. Las FKs que apuntan al stage ya degradan sin romper: `active_stage_id`
y `project_tasks.stage_id` son `ON DELETE SET NULL` (0046/0047), así que borrar un
stage deja el proyecto sin stage activo y sus tasks bajo "No stage", no en un estado
inconsistente.

## Considered Options

- **Archivar/desactivar en vez de borrar** (mantener el patrón "nobody deletes" con
  una columna `archived`/`deleted_at`) — descartada: deja stages fantasma acumulándose,
  obliga a filtrar "archivados" en cada lectura, y contradice que "Zoho es la fuente de
  verdad de qué stages existen". El usuario pidió explícitamente que se borre del Desk.
- **No borrar nunca; solo dejar de traerlo** — descartada: el stage huérfano seguiría
  con su budget y apareciendo en el árbol/summary sin respaldo en Zoho.

## Consequences

- El borrado de un Stage es **destructivo** sobre un dato del Desk (`budget_hours`) que
  Zoho no tiene y no puede reponer. Se acepta porque solo ocurre sobre stages que Zoho
  eliminó y que (por dominio) no están en curso.
- El sync necesita **detectar bajas** (stages que estaban y ya no vienen de Zoho para ese
  proyecto), no solo altas/updates — es un diff, no un upsert puro.
- Si alguna vez se borra en Zoho un stage que SÍ tenía budget vivo (contra lo esperado),
  ese budget se pierde sin aviso. Si eso resultara un problema, la reversión natural es
  volver a "archivar en vez de borrar" (este ADR quedaría superseded).
