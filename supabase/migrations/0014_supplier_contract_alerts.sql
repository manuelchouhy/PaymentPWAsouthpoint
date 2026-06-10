-- =============================================================================
-- FR-16 · Alertas de Supplier Contracts (con prioridad southpointlabs)
-- =============================================================================
-- Umbrales 90/60/30/0 días. Proveedores priority reciben un trato distinto:
-- email diario a una lista propia, banner persistente y sin dismiss manual.
-- Reutiliza email_outbox (creada en 0005) como cola de emails (stub).
-- =============================================================================

-- ── Configuración (fila única id = 1) ────────────────────────────────────────
create table if not exists public.supplier_alert_settings (
  id                                  integer primary key default 1,
  threshold_1_days                    integer not null default 90,
  threshold_2_days                    integer not null default 60,
  threshold_3_days                    integer not null default 30,
  email_recipients                    text[]  not null default '{}',
  priority_supplier_email_recipients  text[]  not null default '{}',
  updated_at                          timestamptz not null default now(),
  updated_by                          text,
  constraint supplier_alert_settings_singleton check (id = 1)
);
insert into public.supplier_alert_settings (id) values (1) on conflict (id) do nothing;


-- ── Log de alertas (emails enviados + acciones tomadas) ──────────────────────
create table if not exists public.supplier_alert_log (
  id                bigint generated always as identity primary key,
  contract_id       bigint not null references public.supplier_contracts (id) on delete cascade,
  threshold_crossed integer,                 -- 90 / 60 / 30 / 0 (null = fila de acción)
  email_sent_at     timestamptz,             -- null = no fue email, fue una acción
  dismissed_at      timestamptz,
  dismissed_by      text,
  action_taken      text check (action_taken in ('renew', 'renew_in_progress', 'manual_dismiss')),
  created_at        timestamptz not null default now()
);
create index if not exists supplier_alert_log_contract_idx
  on public.supplier_alert_log (contract_id, threshold_crossed);
create index if not exists supplier_alert_log_sent_idx
  on public.supplier_alert_log (contract_id, email_sent_at);


-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.supplier_alert_settings enable row level security;
alter table public.supplier_alert_log      enable row level security;

-- settings: leer + editar (la pantalla de configuración la edita la app)
drop policy if exists "auth read supplier_alert_settings" on public.supplier_alert_settings;
create policy "auth read supplier_alert_settings" on public.supplier_alert_settings
  for select to authenticated using (true);
drop policy if exists "auth update supplier_alert_settings" on public.supplier_alert_settings;
create policy "auth update supplier_alert_settings" on public.supplier_alert_settings
  for update to authenticated using (true) with check (true);

-- log: la app lee siempre, e inserta filas de ACCIÓN (renew / renewal in progress).
-- La Edge Function (service_role) inserta las filas de email. Nadie borra.
drop policy if exists "auth read supplier_alert_log" on public.supplier_alert_log;
create policy "auth read supplier_alert_log" on public.supplier_alert_log
  for select to authenticated using (true);
drop policy if exists "auth insert supplier_alert_log" on public.supplier_alert_log;
create policy "auth insert supplier_alert_log" on public.supplier_alert_log
  for insert to authenticated with check (true);


-- ── Cron diario (opcional · requiere pg_cron + pg_net) ───────────────────────
-- select cron.schedule(
--   'supplier-contract-alerts-daily', '0 8 * * *',
--   $$ select net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/supplier-contract-alerts',
--     headers := jsonb_build_object('Authorization','Bearer <SERVICE_ROLE_KEY>','Content-Type','application/json')
--   ); $$
-- );
