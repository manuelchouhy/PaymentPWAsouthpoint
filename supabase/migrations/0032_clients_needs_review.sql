-- Auto-provisión de clientes desde los Project Groups de Zoho.
--
-- El sync crea un cliente por cada grupo de Zoho que todavía no tenga uno (nombre
-- del cliente = nombre del grupo). Esos clientes nacen con datos incompletos
-- (contactos vacíos, sin MSA), así que se marcan needs_review = true para avisar en
-- la UI que hay que completarlos. Al editarlos y guardarlos a mano, la app limpia
-- la marca.
alter table public.clients
  add column if not exists needs_review boolean not null default false;

comment on column public.clients.needs_review is
  'true = cliente auto-creado por el sync desde un Project Group de Zoho, con datos a completar. La app lo limpia al guardar una edición manual.';
