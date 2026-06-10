-- =============================================================================
-- FR-08 · Alertas de vencimiento de contratos de cliente
-- =============================================================================
-- Incluye también `email_outbox`, la tabla-stub de emails que comparten TODAS
-- las alertas de Fase 3 (prompts 9, 11, 13, 16). Mientras no haya un servicio
-- de email (Resend), las Edge Functions encolan acá y se procesa después.
-- =============================================================================

-- ── Configuración global de umbrales (fila única id = 1) ─────────────────────
create table if not exists public.contract_alert_settings (
  id                integer primary key default 1,
  threshold_1_days  integer not null default 90,
  threshold_2_days  integer not null default 60,
  threshold_3_days  integer not null default 30,
  email_recipients  text[]  not null default '{}',
  email_frequency   text    not null default 'on_threshold_cross'
                      check (email_frequency in ('daily', 'weekly', 'on_threshold_cross')),
  updated_at        timestamptz not null default now(),
  updated_by        text,
  constraint contract_alert_settings_singleton check (id = 1)
);
insert into public.contract_alert_settings (id) values (1) on conflict (id) do nothing;


-- ── Log de alertas enviadas (para no spamear en 'on_threshold_cross') ────────
create table if not exists public.contract_alert_log (
  id              bigint generated always as identity primary key,
  project_id      bigint not null references public.projects (id) on delete cascade,
  threshold_days  integer not null,        -- 90 / 60 / 30 / 0 (expirado)
  days_remaining  integer,
  email_sent_at   timestamptz not null default now()
);
create index if not exists contract_alert_log_project_idx
  on public.contract_alert_log (project_id, threshold_days);


-- ── email_outbox: cola de emails (stub compartido por todas las alertas) ─────
create table if not exists public.email_outbox (
  id          bigint generated always as identity primary key,
  recipients  text[] not null,
  subject     text not null,
  body        text not null,
  category    text,                         -- 'contract_alert', etc.
  created_at  timestamptz not null default now(),
  sent_at     timestamptz                   -- null = pendiente de envío
);
create index if not exists email_outbox_unsent_idx
  on public.email_outbox (created_at) where sent_at is null;


-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.contract_alert_settings enable row level security;
alter table public.contract_alert_log      enable row level security;
alter table public.email_outbox            enable row level security;

-- settings: leer + editar (la pantalla de configuración la edita la app)
drop policy if exists "auth read contract_alert_settings" on public.contract_alert_settings;
create policy "auth read contract_alert_settings" on public.contract_alert_settings
  for select to authenticated using (true);
drop policy if exists "auth update contract_alert_settings" on public.contract_alert_settings;
create policy "auth update contract_alert_settings" on public.contract_alert_settings
  for update to authenticated using (true) with check (true);

-- log y outbox: sólo lectura desde la app (los inserta la Edge Function con service_role)
drop policy if exists "auth read contract_alert_log" on public.contract_alert_log;
create policy "auth read contract_alert_log" on public.contract_alert_log
  for select to authenticated using (true);
drop policy if exists "auth read email_outbox" on public.email_outbox;
create policy "auth read email_outbox" on public.email_outbox
  for select to authenticated using (true);


-- ── Cron diario (opcional · requiere extensiones pg_cron + pg_net) ────────────
-- 1) Activá las extensiones en Database → Extensions: pg_cron y pg_net.
-- 2) Reemplazá <PROJECT_REF> y <SERVICE_ROLE_KEY> y corré:
--
-- select cron.schedule(
--   'project-contract-alerts-daily',
--   '0 8 * * *',                                  -- 08:00 UTC todos los días
--   $$
--   select net.http_post(
--     url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/project-contract-alerts',
--     headers := jsonb_build_object(
--       'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
--       'Content-Type',  'application/json'
--     )
--   );
--   $$
-- );
