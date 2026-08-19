-- Cliente derivado del Project Group de Zoho (slice 3, PRD entries-billing-by-client).
--
-- En Zoho el cliente NO es un campo: es el Project Group del proyecto. Esta
-- migración agrega las columnas para materializar la cadena
--   hora → proyecto (por id de Zoho) → grupo → cliente (por alias)
-- sin tocar nada de lo existente. Todo es aditivo y nullable.

-- 1. Grupo crudo de Zoho en el proyecto. Se guarda tal cual (aparte de la
--    resolución) para poder re-resolver sin re-sincronizar y para soportar
--    mañana otra fuente con otra nomenclatura (pedido de Eduardo).
alter table public.projects
  add column if not exists zoho_project_group text;

comment on column public.projects.zoho_project_group is
  'Nombre del Project Group en Zoho (allí el cliente vive como grupo, no como campo). Dato crudo; la resolución a cliente se hace por alias/nombre contra clients. Al actualizar un proyecto existente el sync escribe el grupo SÓLO cuando lo encuentra en un grupo; si no lo encuentra (archivado, o fallo parcial de la consulta de grupos) NO toca la columna, para no borrar el grupo ya guardado. Al INSERTAR un proyecto nuevo ausente del mapa sí queda null (no hay valor previo que proteger). NUNCA escribe client_id (el override manual gana).';

-- 2. Id de Zoho del proyecto en cada hora: la hora se une al proyecto por este
--    id, no por nombre, para que un rename o un espacio de más no deje horas
--    huérfanas. El nombre queda como fallback en la app.
alter table public.time_entries
  add column if not exists zoho_project_id text;

create index if not exists time_entries_zoho_project_id_idx
  on public.time_entries (zoho_project_id);

comment on column public.time_entries.zoho_project_id is
  'Id del proyecto en Zoho (id_string). Llave hora→proyecto, más robusta que el nombre. El sync lo popula; puede ser null en filas viejas hasta la próxima corrida.';

-- 3. Alias del cliente: el/los nombres con que aparece en la fuente externa
--    (ej. grupo "HSS" → cliente "HSSStaffing"). Si el grupo coincide con el
--    nombre del cliente no hace falta cargar alias. Único case-insensitive entre
--    los no nulos: dos clientes no pueden reclamar el mismo grupo.
alter table public.clients
  add column if not exists zoho_group_name text;

-- La expresión replica normalizeClientKey del resolver (minúsculas + colapso de
-- espacios + trim). Si el índice sólo hiciera lower(), 'HSS Team' y 'HSS  Team'
-- pasarían como distintos en la base pero colisionarían en memoria (uno pisa al
-- otro, cliente equivocado). Alineándolos, la base rechaza el alias duplicado.
create unique index if not exists clients_zoho_group_name_key
  on public.clients (btrim(regexp_replace(lower(zoho_group_name), '\s+', ' ', 'g')))
  where zoho_group_name is not null;

comment on column public.clients.zoho_group_name is
  'Alias: nombre del Project Group de Zoho que mapea a este cliente. Sólo hace falta cuando difiere de client_name (p.ej. "HSS" → "HSSStaffing"). Único case-insensitive.';
