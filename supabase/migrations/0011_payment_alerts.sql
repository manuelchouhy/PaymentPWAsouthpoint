-- =============================================================================
-- FR-13 · Alertas de pago a contractor vencido
-- =============================================================================

create table if not exists public.payment_alert_settings (
  id                       integer primary key default 1,
  warning_days_before_due  integer not null default 3,
  email_recipients         text[]  not null default '{}',
  email_frequency          text    not null default 'daily'
                             check (email_frequency in ('daily')),
  updated_at               timestamptz not null default now(),
  updated_by               text,
  constraint payment_alert_settings_singleton check (id = 1)
);
insert into public.payment_alert_settings (id) values (1) on conflict (id) do nothing;

alter table public.payment_alert_settings enable row level security;

drop policy if exists "auth read payment_alert_settings" on public.payment_alert_settings;
create policy "auth read payment_alert_settings" on public.payment_alert_settings
  for select to authenticated using (true);
drop policy if exists "auth update payment_alert_settings" on public.payment_alert_settings;
create policy "auth update payment_alert_settings" on public.payment_alert_settings
  for update to authenticated using (true) with check (true);


-- ── Cron diario (opcional · pg_cron + pg_net) ────────────────────────────────
-- select cron.schedule(
--   'payment-alerts-daily', '0 10 * * *',
--   $$ select net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/payment-alerts',
--     headers := jsonb_build_object('Authorization','Bearer <SERVICE_ROLE_KEY>','Content-Type','application/json')
--   ); $$
-- );
