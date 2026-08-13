-- =============================================================================
-- Issue 13 (Capacidad) · supplier_contracts: horas/semana contratadas
-- =============================================================================
-- Prep para el módulo de Capacidad (issue 14, todavía no construido): la
-- tarjeta "Capacidad contratada" necesita suplementar cuántas horas/semana
-- tiene pactadas cada contrato de proveedor. Confirmado por el HTML del
-- prototipo ("h/sem según contrato"). Columna nueva, nullable, sin backfill:
-- los contratos existentes quedan en null hasta que alguien la complete a
-- mano en una edición — no se toca ni se infiere ningún dato ya cargado.
-- =============================================================================

alter table public.supplier_contracts
  add column if not exists weekly_contracted_hours numeric
    check (weekly_contracted_hours is null or weekly_contracted_hours >= 0);
