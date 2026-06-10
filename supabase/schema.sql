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
  client        text,                  -- FR-02 · cliente del proyecto (Zoho)
  task          text,
  task_number   text,                  -- FR-02 · id numérico de la tarea (Zoho)
  description   text,
  notes         text,
  log_date      date,
  hours         numeric not null,
  status        text,                  -- 'Approved' | 'Rejected'
  synced_at     timestamptz not null default now()
);

-- NOTA (FR-02): si poblaste `time_entries` ANTES de agregar `client` /
-- `task_number`, esas filas quedan con esos campos en NULL. No hay que migrar
-- datos a mano: el próximo sync los completa solo, porque la Edge Function hace
-- upsert por `zoho_log_id` (idempotente) y reescribe las dos columnas nuevas.

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
-- TABLA: invoices  (FR-05 · emisión de facturas, etapa previa al pago)
-- ---------------------------------------------------------------------------
-- Separa la facturación del pago: Facturar (Billing) → Cobrar (Collections) →
-- Pagar al contractor (Payment). Esta tabla cubre la emisión de la factura.
-- `payments` se mantiene para los pagos al contractor (FR-10).
create table if not exists public.invoices (
  id                       bigint generated always as identity primary key,
  supplier_invoice_number  text not null,
  invoice_date             date not null,
  total_amount             numeric(12, 2) not null,
  notes                    text,
  user_name                text not null,          -- contractor
  entry_ids                bigint[] not null,       -- time entries incluidas
  status                   text not null default 'Invoiced'
                             check (status in ('Invoiced', 'Collected', 'Paid')),
  created_at               timestamptz not null default now(),
  created_by               text                     -- email del usuario logueado
);

create index if not exists invoices_user_name_idx  on public.invoices (user_name);
create index if not exists invoices_status_idx     on public.invoices (status);
create index if not exists invoices_created_at_idx on public.invoices (created_at desc);


-- ---------------------------------------------------------------------------
-- TABLA: invoice_status_history  (auditoría del ciclo de vida de Billing Status)
-- ---------------------------------------------------------------------------
-- Una fila por cada transición de estado de una factura. Alimenta el historial
-- en la pantalla de detalle de factura (FR-06).
create table if not exists public.invoice_status_history (
  id           bigint generated always as identity primary key,
  invoice_id   bigint not null references public.invoices (id) on delete cascade,
  from_status  text,
  to_status    text not null,
  changed_at   timestamptz not null default now(),
  changed_by   text,
  note         text
);

create index if not exists invoice_status_history_invoice_idx
  on public.invoice_status_history (invoice_id, changed_at desc);


-- ---------------------------------------------------------------------------
-- TABLA: sync_status  (FR-01)
-- ---------------------------------------------------------------------------
-- Fila ÚNICA (singleton, id = 1) con el resultado del último sync. La Edge
-- Function `sync-time-logs` la actualiza (upsert) al final de cada corrida.
create table if not exists public.sync_status (
  id                  integer primary key default 1,
  last_synced_at      timestamptz,
  last_status         text,            -- 'OK' | 'Error'
  last_records_count  integer,
  last_error_message  text,
  constraint sync_status_singleton check (id = 1)
);

-- Sembrar la fila singleton para que siempre exista.
insert into public.sync_status (id) values (1) on conflict (id) do nothing;


-- ---------------------------------------------------------------------------
-- TABLA: sync_log  (FR-01)
-- ---------------------------------------------------------------------------
-- Historial de corridas del sync (una fila por corrida). La pantalla de log
-- lista las últimas 50 ordenadas por fecha desc.
create table if not exists public.sync_log (
  id              bigint generated always as identity primary key,
  ran_at          timestamptz not null default now(),
  status          text not null,       -- 'OK' | 'Error'
  records_count   integer,
  error_message   text
);

create index if not exists sync_log_ran_at_idx on public.sync_log (ran_at desc);


-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- RLS habilitado en ambas tablas. POR DEFECTO nadie puede leer ni escribir
-- con la anon key — revisá las políticas comentadas más abajo y descomentá la
-- que corresponda a cómo manejes el acceso a la app.
alter table public.time_entries enable row level security;
alter table public.payments     enable row level security;
alter table public.invoices     enable row level security;
alter table public.invoice_status_history enable row level security;
alter table public.sync_status  enable row level security;
alter table public.sync_log     enable row level security;

-- OPCIÓN A — Herramienta interna SIN login de Supabase (modo más simple).
-- La PWA usa la anon key como si fuese una "clave de cliente" y dejás abierto
-- el acceso. Sólo aceptable si la URL no se publica y el riesgo es bajo.
-- Recordá: la anon key viaja embebida en el bundle.
--
-- create policy "anon read time_entries"  on public.time_entries for select to anon using (true);
-- create policy "anon read payments"      on public.payments     for select to anon using (true);
-- create policy "anon insert payments"    on public.payments     for insert to anon with check (true);
-- create policy "anon read invoices"      on public.invoices     for select to anon using (true);
-- create policy "anon insert invoices"    on public.invoices     for insert to anon with check (true);
-- create policy "anon update invoices"    on public.invoices     for update to anon using (true) with check (true);
-- create policy "anon read inv_history"   on public.invoice_status_history for select to anon using (true);
-- create policy "anon insert inv_history" on public.invoice_status_history for insert to anon with check (true);
-- create policy "anon read sync_status"   on public.sync_status  for select to anon using (true);
-- create policy "anon read sync_log"      on public.sync_log     for select to anon using (true);

-- OPCIÓN B — Herramienta interna CON Supabase Auth (recomendado).
-- Sólo usuarios autenticados pueden leer/escribir. Esto requiere agregar un
-- flujo de login en la app (magic link, OAuth, etc.).
--
-- create policy "auth read time_entries"  on public.time_entries for select to authenticated using (true);
-- create policy "auth read payments"      on public.payments     for select to authenticated using (true);
-- create policy "auth insert payments"    on public.payments     for insert to authenticated with check (true);
-- create policy "auth read invoices"      on public.invoices     for select to authenticated using (true);
-- create policy "auth insert invoices"    on public.invoices     for insert to authenticated with check (true);
-- create policy "auth update invoices"    on public.invoices     for update to authenticated using (true) with check (true);
-- create policy "auth read inv_history"   on public.invoice_status_history for select to authenticated using (true);
-- create policy "auth insert inv_history" on public.invoice_status_history for insert to authenticated with check (true);
-- create policy "auth read sync_status"   on public.sync_status  for select to authenticated using (true);
-- create policy "auth read sync_log"      on public.sync_log     for select to authenticated using (true);

-- OPCIÓN C — Mantener RLS estricto y operar desde un backend con la service_role
-- key (ej. Supabase Edge Function que reciba el pago y lo inserte). No hace
-- falta ninguna política para anon en ese caso.


-- ---------------------------------------------------------------------------
-- Datos de ejemplo (espejan los datos mock de src/lib/data.js)
-- ---------------------------------------------------------------------------
-- Se usa `on conflict do nothing` sobre zoho_log_id para que el script sea
-- idempotente: podés correrlo varias veces sin duplicar filas.
insert into public.time_entries
  (zoho_log_id, user_name, project, client, task, task_number, description, notes, log_date, hours, status)
values
  ('mock-te-01', 'Florencia Sarasúa', 'CONTRACT DOMO DEVELOPMENT & IT SUPPORT', 'HSS',                 '5 - HSS Data Modeling ETL DOMO', '1001', 'Modelado de datos para el tablero de operaciones', 'Validado con el equipo de datos', '2026-05-04', 7.5, 'Approved'),
  ('mock-te-02', 'Florencia Sarasúa', 'CONTRACT DOMO DEVELOPMENT & IT SUPPORT', 'HSS',                 'HSS Maintenance ETL/Dashboard',   '1002', 'Mantenimiento de los flujos ETL nocturnos',       '',                                  '2026-05-08', 4,   'Approved'),
  ('mock-te-03', 'Florencia Sarasúa', 'CONTRACT ANALYTICS PLATFORM',            'Acme Analytics',      'API Integration',                  '2001', 'Integración con la API de facturación',          'Pendiente credenciales de producción','2026-05-13', 6,   'Approved'),
  ('mock-te-04', 'Matías Sarasúa',    'CONTRACT DOMO DEVELOPMENT & IT SUPPORT', 'HSS',                 '5 - HSS APP Development DOMO',     '1003', 'Desarrollo de la vista de aprobaciones',         'Revisión de QA agendada',           '2026-05-05', 8,   'Approved'),
  ('mock-te-05', 'Matías Sarasúa',    'CONTRACT DOMO DEVELOPMENT & IT SUPPORT', 'HSS',                 '5 - HSS APP Development DOMO',     '1003', 'Corrección de bugs en el módulo de carga',       'Reabierto por QA',                  '2026-05-11', 3.5, 'Rejected'),
  ('mock-te-06', 'Matías Sarasúa',    'CONTRACT ANALYTICS PLATFORM',            'Acme Analytics',      'Development',                      '2002', 'Componentes de gráficos reutilizables',          'Documentado en Storybook',          '2026-05-15', 6.5, 'Approved'),
  ('mock-te-07', 'Diego Pérez',       'CONTRACT ANALYTICS PLATFORM',            'Acme Analytics',      'API Integration',                  '2001', 'Conexión del pipeline de eventos',               'Coordinar con infraestructura',     '2026-04-29', 9,   'Approved'),
  ('mock-te-08', 'Diego Pérez',       'INTERNAL HOURS ALLOCATION',              'Southpoint (interno)','Development',                      '3001', 'Refactor del servicio de autenticación',         '',                                  '2026-05-06', 5,   'Approved'),
  ('mock-te-09', 'Diego Pérez',       'CONTRACT DOMO DEVELOPMENT & IT SUPPORT', 'HSS',                 'HSS Maintenance ETL/Dashboard',    '1002', 'Soporte y monitoreo de dashboards',              'Incidente resuelto el mismo día',   '2026-05-12', 2,   'Approved'),
  ('mock-te-10', 'Lucía Méndez',      'CONTRACT DOMO DEVELOPMENT & IT SUPPORT', 'HSS',                 '5 - HSS Data Modeling ETL DOMO',   '1001', 'Diseño del modelo dimensional de ventas',        'Aprobado por el área de negocio',   '2026-05-07', 11,  'Approved'),
  ('mock-te-11', 'Lucía Méndez',      'INTERNAL HOURS ALLOCATION',              'Southpoint (interno)','Development',                      '3001', 'Capacitación interna del equipo',                'Fuera del alcance del contrato',    '2026-05-14', 1.5, 'Rejected'),
  ('mock-te-12', 'Lucía Méndez',      'CONTRACT ANALYTICS PLATFORM',            'Acme Analytics',      'API Integration',                  '2001', 'Pruebas de carga sobre los endpoints',           'Resultados dentro del SLA',         '2026-05-18', 6,   'Approved')
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
