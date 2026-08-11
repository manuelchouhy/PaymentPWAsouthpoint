-- =============================================================================
-- Fase 4a (cont.) — bucket de Storage para los PDFs de SOW y Change Requests.
-- El MSA sigue en su propio bucket 'client-msa' (0017); este es para todo lo
-- que se sube desde Projects and SOW.
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('project-documents', 'project-documents', false)
on conflict (id) do nothing;

drop policy if exists "auth upload project-documents" on storage.objects;
create policy "auth upload project-documents" on storage.objects
  for insert to authenticated with check (bucket_id = 'project-documents');

drop policy if exists "auth read project-documents" on storage.objects;
create policy "auth read project-documents" on storage.objects
  for select to authenticated using (bucket_id = 'project-documents');
