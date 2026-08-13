-- =============================================================================
-- project_documents: una sola fila por (subject, version)
-- =============================================================================
-- El número de versión se calcula contando las versiones previas y sumando 1.
-- Entre ese count y el insert hay una ventana: dos subidas simultáneas al
-- mismo documento cuentan lo mismo y escriben la misma versión, dejando dos
-- filas "v3" y ningún "v4". 0020 solo creó un índice NO único
-- (subject_type, subject_id, version desc), que no lo impide.
--
-- Con este índice único el segundo insert falla con 23505 y la capa de datos
-- (recordProjectDocumentStrict) reintenta con el siguiente número libre —
-- mismo patrón que ya usa createChangeRequest para cr_number.
--
-- OJO al aplicar: si ya existieran duplicados de (subject_type, subject_id,
-- version) la creación del índice falla. Para verificar antes:
--   select subject_type, subject_id, version, count(*)
--     from public.project_documents
--    group by 1, 2, 3 having count(*) > 1;
-- =============================================================================

create unique index if not exists project_documents_subject_version_key
  on public.project_documents (subject_type, subject_id, version);
