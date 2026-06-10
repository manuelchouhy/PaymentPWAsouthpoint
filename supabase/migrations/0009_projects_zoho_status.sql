-- =============================================================================
-- FR-07 (ajuste) · Traer el status del proyecto desde Zoho
-- =============================================================================
-- Status de Zoho (active / archived / on hold / ...). Es distinto del estado de
-- CONTRATO (Expired/Critical/...) que se calcula desde contract_expiration_date.
-- =============================================================================

alter table public.projects
  add column if not exists zoho_status text;
