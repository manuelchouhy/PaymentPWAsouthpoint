-- =============================================================================
-- FR-14 · Supplier Contracts — campo Rol del contractor
-- =============================================================================
-- Rol (texto libre, opcional) del contractor en el contrato (ej. "Developer",
-- "QA"). No destructivo: solo agrega la columna. Idempotente.
-- =============================================================================

alter table public.supplier_contracts
  add column if not exists role text;
