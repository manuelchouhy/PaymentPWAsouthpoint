-- =============================================================================
-- Fase 4c — el wizard nuevo de Projects and SOW no pide project_number,
-- contract_number ni contract_expiration_date (eso era del alta vieja). Los
-- aflojamos a nullable; contractStatus() ya sabía manejar "sin contrato"
-- ("No Contract") para proyectos de Zoho sin esos datos, así que no rompe la
-- pantalla de alertas de contrato existente.
-- =============================================================================

alter table public.projects
  alter column project_number drop not null,
  alter column contract_number drop not null,
  alter column contract_expiration_date drop not null;
