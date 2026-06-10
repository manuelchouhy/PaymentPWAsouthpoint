-- =============================================================================
-- FR-12 · Alertas de cobro pendiente (Collections)
-- =============================================================================

-- Plazo de pago de la factura (días). Default 30 hasta conectar con Projects.
alter table public.invoices
  add column if not exists payment_terms_days integer not null default 30;

-- Configuración global de alertas de cobro (fila única id = 1).
create table if not exists public.collection_alert_settings (
  id                       integer primary key default 1,
  warning_days_before_due  integer not null default 7,
  overdue_immediately      boolean not null default true,
  email_recipients         text[]  not null default '{}',
  email_frequency          text    not null default 'daily'
                             check (email_frequency in ('daily', 'realtime')),
  updated_at               timestamptz not null default now(),
  updated_by               text,
  constraint collection_alert_settings_singleton check (id = 1)
);
insert into public.collection_alert_settings (id) values (1) on conflict (id) do nothing;

-- RLS
alter table public.collection_alert_settings enable row level security;

drop policy if exists "auth read collection_alert_settings" on public.collection_alert_settings;
create policy "auth read collection_alert_settings" on public.collection_alert_settings
  for select to authenticated using (true);
drop policy if exists "auth update collection_alert_settings" on public.collection_alert_settings;
create policy "auth update collection_alert_settings" on public.collection_alert_settings
  for update to authenticated using (true) with check (true);


-- ── Cron diario (opcional · requiere pg_cron + pg_net) ───────────────────────
-- select cron.schedule(
--   'collection-alerts-daily', '0 9 * * *',
--   $$ select net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/collection-alerts',
--     headers := jsonb_build_object('Authorization','Bearer <SERVICE_ROLE_KEY>','Content-Type','application/json')
--   ); $$
-- );
