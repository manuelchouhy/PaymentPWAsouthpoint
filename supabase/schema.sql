-- =============================================================================
-- payment-pwa · esquema inicial (Fase 2)
-- =============================================================================
-- Cómo correrlo:
--   1. Entrá al proyecto en https://supabase.com → SQL Editor.
--   2. Pegá todo este archivo y ejecutá.
--   3. Verificá las tablas en Table Editor: `time_entries` y `payments`.
--   4. Las filas de ejemplo (final del archivo) ya quedan cargadas para que la
--      app lea datos reales ni bien apuntás las env vars al proyecto.
--
-- En Fase 3 (sync con Zoho Projects vía Supabase Edge Functions) se pobla
-- `time_entries` de forma incremental usando `zoho_log_id` como clave de
-- deduplicación (upsert).
-- =============================================================================


-- ---------------------------------------------------------------------------
-- TABLA: time_entries
-- ---------------------------------------------------------------------------
create table if not exists public.time_entries (
  id            bigint generated always as identity primary key,
  zoho_log_id   text unique,           -- id del log en Zoho (nullable mientras no haya sync)
  user_name     text not null,
  project       text,
  task          text,
  description   text,
  notes         text,
  log_date      date,
  hours         numeric not null,
  status        text,                  -- 'Approved' | 'Rejected'
  synced_at     timestamptz not null default now()
);

create index if not exists time_entries_user_name_idx on public.time_entries (user_name);
create index if not exists time_entries_log_date_idx  on public.time_entries (log_date desc);


-- ---------------------------------------------------------------------------
-- TABLA: payments
-- ---------------------------------------------------------------------------
create table if not exists public.payments (
  id                  bigint generated always as identity primary key,
  user_name           text not null,
  total_hours         numeric not null,
  invoice_number      text not null,
  transaction_number  text,
  entry_ids           bigint[],
  created_at          timestamptz not null default now()
);

create index if not exists payments_user_name_idx  on public.payments (user_name);
create index if not exists payments_created_at_idx on public.payments (created_at desc);


-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- RLS habilitado en ambas tablas. POR DEFECTO nadie puede leer ni escribir
-- con la anon key — revisá las políticas comentadas más abajo y descomentá la
-- que corresponda a cómo manejes el acceso a la app.
alter table public.time_entries enable row level security;
alter table public.payments     enable row level security;

-- OPCIÓN A — Herramienta interna SIN login de Supabase (modo más simple).
-- La PWA usa la anon key como si fuese una "clave de cliente" y dejás abierto
-- el acceso. Sólo aceptable si la URL no se publica y el riesgo es bajo.
-- Recordá: la anon key viaja embebida en el bundle.
--
-- create policy "anon read time_entries"  on public.time_entries for select to anon using (true);
-- create policy "anon read payments"      on public.payments     for select to anon using (true);
-- create policy "anon insert payments"    on public.payments     for insert to anon with check (true);

-- OPCIÓN B — Herramienta interna CON Supabase Auth (recomendado).
-- Sólo usuarios autenticados pueden leer/escribir. Esto requiere agregar un
-- flujo de login en la app (magic link, OAuth, etc.).
--
-- create policy "auth read time_entries"  on public.time_entries for select to authenticated using (true);
-- create policy "auth read payments"      on public.payments     for select to authenticated using (true);
-- create policy "auth insert payments"    on public.payments     for insert to authenticated with check (true);

-- OPCIÓN C — Mantener RLS estricto y operar desde un backend con la service_role
-- key (ej. Supabase Edge Function que reciba el pago y lo inserte). No hace
-- falta ninguna política para anon en ese caso.


-- ---------------------------------------------------------------------------
-- Datos de ejemplo (espejan los datos mock de src/lib/data.js)
-- ---------------------------------------------------------------------------
-- Se usa `on conflict do nothing` sobre zoho_log_id para que el script sea
-- idempotente: podés correrlo varias veces sin duplicar filas.
insert into public.time_entries
  (zoho_log_id, user_name, project, task, description, notes, log_date, hours, status)
values
  ('mock-te-01', 'Florencia Sarasúa', 'CONTRACT DOMO DEVELOPMENT & IT SUPPORT', '5 - HSS Data Modeling ETL DOMO', 'Modelado de datos para el tablero de operaciones', 'Validado con el equipo de datos', '2026-05-04', 7.5, 'Approved'),
  ('mock-te-02', 'Florencia Sarasúa', 'CONTRACT DOMO DEVELOPMENT & IT SUPPORT', 'HSS Maintenance ETL/Dashboard',   'Mantenimiento de los flujos ETL nocturnos',       '',                                  '2026-05-08', 4,   'Approved'),
  ('mock-te-03', 'Florencia Sarasúa', 'CONTRACT ANALYTICS PLATFORM',            'API Integration',                  'Integración con la API de facturación',          'Pendiente credenciales de producción','2026-05-13', 6,   'Approved'),
  ('mock-te-04', 'Matías Sarasúa',    'CONTRACT DOMO DEVELOPMENT & IT SUPPORT', '5 - HSS APP Development DOMO',     'Desarrollo de la vista de aprobaciones',         'Revisión de QA agendada',           '2026-05-05', 8,   'Approved'),
  ('mock-te-05', 'Matías Sarasúa',    'CONTRACT DOMO DEVELOPMENT & IT SUPPORT', '5 - HSS APP Development DOMO',     'Corrección de bugs en el módulo de carga',       'Reabierto por QA',                  '2026-05-11', 3.5, 'Rejected'),
  ('mock-te-06', 'Matías Sarasúa',    'CONTRACT ANALYTICS PLATFORM',            'Development',                      'Componentes de gráficos reutilizables',          'Documentado en Storybook',          '2026-05-15', 6.5, 'Approved'),
  ('mock-te-07', 'Diego Pérez',       'CONTRACT ANALYTICS PLATFORM',            'API Integration',                  'Conexión del pipeline de eventos',               'Coordinar con infraestructura',     '2026-04-29', 9,   'Approved'),
  ('mock-te-08', 'Diego Pérez',       'INTERNAL HOURS ALLOCATION',              'Development',                      'Refactor del servicio de autenticación',         '',                                  '2026-05-06', 5,   'Approved'),
  ('mock-te-09', 'Diego Pérez',       'CONTRACT DOMO DEVELOPMENT & IT SUPPORT', 'HSS Maintenance ETL/Dashboard',    'Soporte y monitoreo de dashboards',              'Incidente resuelto el mismo día',   '2026-05-12', 2,   'Approved'),
  ('mock-te-10', 'Lucía Méndez',      'CONTRACT DOMO DEVELOPMENT & IT SUPPORT', '5 - HSS Data Modeling ETL DOMO',   'Diseño del modelo dimensional de ventas',        'Aprobado por el área de negocio',   '2026-05-07', 11,  'Approved'),
  ('mock-te-11', 'Lucía Méndez',      'INTERNAL HOURS ALLOCATION',              'Development',                      'Capacitación interna del equipo',                'Fuera del alcance del contrato',    '2026-05-14', 1.5, 'Rejected'),
  ('mock-te-12', 'Lucía Méndez',      'CONTRACT ANALYTICS PLATFORM',            'API Integration',                  'Pruebas de carga sobre los endpoints',           'Resultados dentro del SLA',         '2026-05-18', 6,   'Approved')
on conflict (zoho_log_id) do nothing;


-- ---------------------------------------------------------------------------
-- Pagos de ejemplo (opcional). Cubren algunas time_entries para poder ver el
-- cruce time_entries ↔ payments en la UI (columna Payment, badge "Pagado",
-- invoice + transaction, stepper con horas pagadas).
--
-- Importante: este bloque referencia los IDs auto-generados que crea Postgres
-- al insertar las time_entries de arriba — los buscamos por `zoho_log_id` para
-- no hardcodear nada. Si más adelante poblás `time_entries` desde Zoho (con
-- otros `zoho_log_id`), este bloque simplemente no inserta nada.
--
-- Comentá / descomentá si querés / no querés cargar pagos de demo en tu base.
-- ---------------------------------------------------------------------------
with paid_florencia as (
  select array_agg(id order by id) as ids,
         sum(hours)                as total_hours
  from public.time_entries
  where zoho_log_id in ('mock-te-01', 'mock-te-02')
),
paid_matias as (
  select array_agg(id order by id) as ids,
         sum(hours)                as total_hours
  from public.time_entries
  where zoho_log_id = 'mock-te-04'
)
insert into public.payments
  (user_name, total_hours, invoice_number, transaction_number, entry_ids)
select 'Florencia Sarasúa', total_hours, 'FA-0001-00000123', null, ids
  from paid_florencia
  where ids is not null
union all
select 'Matías Sarasúa',    total_hours, 'FA-0001-00000124', 'TRX-00891', ids
  from paid_matias
  where ids is not null;
