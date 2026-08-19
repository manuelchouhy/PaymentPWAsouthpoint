-- MSA opcional en clients (PRD entries-billing-by-client, mapeo de clientes internos).
--
-- msa_url pasa a nullable: hay clientes sin MSA legítimamente —trabajo interno de
-- la propia empresa (grupo de Zoho "SouthPoint Internal"), y clientes reales dados
-- de alta antes de firmar el MSA—. El form deja de exigirlo en el alta. El
-- historial versionado del MSA (project_documents) no cambia: sólo se registra una
-- versión cuando efectivamente se sube un archivo.
alter table public.clients
  alter column msa_url drop not null;
