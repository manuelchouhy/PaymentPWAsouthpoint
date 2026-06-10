-- =============================================================================
-- FR-07 (ajuste) · Auto-crear proyectos desde Zoho
-- =============================================================================
-- El sync de Zoho ya recorre todos los proyectos para traer los time logs;
-- ahora también los crea/actualiza en `projects` (client, project_name,
-- project_number). Los campos de contrato NO vienen de Zoho, así que se
-- relajan a NULL para completarlos a mano desde la app.
-- =============================================================================

-- Id de Zoho para upsert idempotente (no pisa ediciones manuales).
alter table public.projects
  add column if not exists zoho_project_id text unique;

-- Los datos de contrato no existen en Zoho → nullable (se completan a mano).
alter table public.projects alter column contract_number drop not null;
alter table public.projects alter column contract_expiration_date drop not null;

create index if not exists projects_zoho_project_idx
  on public.projects (zoho_project_id);
