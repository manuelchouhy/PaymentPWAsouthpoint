-- =============================================================================
-- SOUTHPOINT TECH LABS — Contractors Management System
-- SCHEMA COMPLETO para migración a nuevo proyecto Supabase
-- Generado: 2026-06-23  |  Versión: Prompts 1-25
--
-- INSTRUCCIONES:
--   1. Crear nuevo proyecto en https://supabase.com
--   2. Dashboard → SQL Editor → pegar este archivo completo y ejecutar
--   3. Activar extensiones (paso 0) ANTES de correr el resto
--   4. Desplegar las 6 Edge Functions (carpeta supabase/functions/)
--   5. Configurar secrets y variables de entorno (sección final)
--   6. Registrar los jobs de pg_cron (sección final)
-- =============================================================================


-- ===========================================================================
-- 0. EXTENSIONES (requieren activarse en Database → Extensions también)
-- ===========================================================================
create extension if not exists "pg_cron";
create extension if not exists "pg_net";


-- ===========================================================================
-- 1. time_entries
-- ===========================================================================
create table if not exists public.time_entries (
  id            bigint generated always as identity primary key,
  zoho_log_id   text unique,           -- id del log en Zoho (upsert key)
  user_name     text not null,
  project       text,
  client        text,
  task          text,
  task_number   text,                  -- id numérico de la tarea en Zoho
  description   text,
  notes         text,
  log_date      date,
  hours         numeric not null,
  status        text,                  -- 'Approved' | 'Rejected' (de Zoho)
  synced_at     timestamptz not null default now()
);

create index if not exists time_entries_user_name_idx on public.time_entries (user_name);
create index if not exists time_entries_log_date_idx  on public.time_entries (log_date desc);


-- ===========================================================================
-- 2. invoices  (FR-05 · emisión de facturas)
-- ===========================================================================
create table if not exists public.invoices (
  id                       bigint generated always as identity primary key,
  supplier_invoice_number  text not null,
  invoice_date             date not null,
  total_amount             numeric(12, 2) not null,
  currency                 text not null default 'USD',   -- USD | UYU | EUR | ARS
  notes                    text,
  user_name                text not null,                 -- contractor
  entry_ids                bigint[] not null,             -- time entries incluidas
  payment_terms_days       integer not null default 30,   -- plazo para cobrar
  status                   text not null default 'Invoiced'
                             check (status in ('Invoiced', 'Collected', 'Paid')),
  created_at               timestamptz not null default now(),
  created_by               text
);

create index if not exists invoices_user_name_idx  on public.invoices (user_name);
create index if not exists invoices_status_idx     on public.invoices (status);
create index if not exists invoices_created_at_idx on public.invoices (created_at desc);


-- ===========================================================================
-- 3. invoice_status_history  (auditoría del ciclo de vida)
-- ===========================================================================
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


-- ===========================================================================
-- 4. payments  (FR-10 · pago al contractor)
-- ===========================================================================
create table if not exists public.payments (
  id                  bigint generated always as identity primary key,
  invoice_id          bigint references public.invoices (id),
  amount_paid         numeric(12, 2) not null,
  currency            text not null default 'USD',   -- moneda de la factura
  exchange_rate       numeric(12, 6),                -- tipo de cambio a USD (null si USD)
  payment_date        date not null,
  transfer_reference  text,
  bank_method         text,
  notes               text,
  back_dated          boolean not null default false,
  created_at          timestamptz not null default now(),
  created_by          text,
  -- Overage (migración 0035): un pago sin factura cubre estas horas y se le paga
  -- a este contractor. Para pagos por factura quedan NULL (el contractor sale de
  -- la factura y las horas viven en invoices.entry_ids).
  entry_ids           bigint[],
  user_name           text
);

-- Un solo pago por factura (unicidad garantizada en la BD)
create unique index if not exists payments_invoice_id_unique on public.payments (invoice_id);
create index if not exists payments_invoice_idx    on public.payments (invoice_id);
create index if not exists payments_created_at_idx on public.payments (created_at desc);


-- ===========================================================================
-- 5. sync_status + sync_log  (FR-01 · estado del sync con Zoho)
-- ===========================================================================
create table if not exists public.sync_status (
  id                  integer primary key default 1,
  last_synced_at      timestamptz,
  last_status         text,           -- 'OK' | 'Error'
  last_records_count  integer,
  last_error_message  text,
  constraint sync_status_singleton check (id = 1)
);
insert into public.sync_status (id) values (1) on conflict (id) do nothing;

create table if not exists public.sync_log (
  id              bigint generated always as identity primary key,
  ran_at          timestamptz not null default now(),
  status          text not null,      -- 'OK' | 'Error'
  records_count   integer,
  error_message   text
);
create index if not exists sync_log_ran_at_idx on public.sync_log (ran_at desc);


-- ===========================================================================
-- 6. projects + project_history  (FR-07 · contratos del cliente)
-- ===========================================================================
create table if not exists public.projects (
  id                        bigint generated always as identity primary key,
  client                    text not null,
  project_name              text not null,
  project_number            text not null unique,
  zoho_project_id           text unique,               -- id de Zoho (upsert key)
  zoho_status               text,                      -- active | archived | on hold
  customer_name             text,
  customer_code             text,
  proposal_name             text,
  proposal_number           text,
  approver                  text,
  customer_manager          text,
  lead_developer            text,
  contract_number           text,
  contract_expiration_date  date,                      -- null hasta completar a mano
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  created_by                text
);

create index if not exists projects_contract_expiration_idx
  on public.projects (contract_expiration_date asc);
create index if not exists projects_client_idx       on public.projects (client);
create index if not exists projects_zoho_project_idx on public.projects (zoho_project_id);

create table if not exists public.project_history (
  id           bigint generated always as identity primary key,
  project_id   bigint not null references public.projects (id) on delete cascade,
  field_name   text not null,
  old_value    text,
  new_value    text,
  changed_at   timestamptz not null default now(),
  changed_by   text
);
create index if not exists project_history_project_idx
  on public.project_history (project_id, changed_at desc);


-- ===========================================================================
-- 7. contract_alert_settings + contract_alert_log  (FR-08)
-- ===========================================================================
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

create table if not exists public.contract_alert_log (
  id              bigint generated always as identity primary key,
  project_id      bigint not null references public.projects (id) on delete cascade,
  threshold_days  integer not null,
  days_remaining  integer,
  email_sent_at   timestamptz not null default now()
);
create index if not exists contract_alert_log_project_idx
  on public.contract_alert_log (project_id, threshold_days);


-- ===========================================================================
-- 8. email_outbox  (cola compartida de emails — todas las alertas)
-- ===========================================================================
create table if not exists public.email_outbox (
  id           bigint generated always as identity primary key,
  recipients   text[] not null,
  subject      text not null,
  body         text not null,
  category     text,                -- 'contract_alert' | 'collection_alert' | etc.
  retry_count  integer not null default 0,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,         -- null = pendiente
  failed_at    timestamptz          -- null = no falló (o ya se reintentan)
);
create index if not exists email_outbox_unsent_idx
  on public.email_outbox (created_at) where sent_at is null;


-- ===========================================================================
-- 9. collections  (FR-09 · cobros de facturas emitidas al cliente)
-- ===========================================================================
create table if not exists public.collections (
  id               bigint generated always as identity primary key,
  invoice_id       bigint not null references public.invoices (id) on delete cascade,
  amount_received  numeric(12, 2) not null,
  collection_date  date not null,
  bank_reference   text,
  voucher_url      text,
  notes            text,
  created_at       timestamptz not null default now(),
  created_by       text
);
create index if not exists collections_invoice_idx on public.collections (invoice_id);
create index if not exists collections_date_idx    on public.collections (collection_date desc);


-- ===========================================================================
-- 10. collection_alert_settings  (FR-12)
-- ===========================================================================
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


-- ===========================================================================
-- 11. payment_alert_settings  (FR-13)
-- ===========================================================================
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


-- ===========================================================================
-- 12. supplier_contracts + supplier_contract_history  (FR-14 + FR-15)
-- ===========================================================================
create table if not exists public.supplier_contracts (
  id                   bigint generated always as identity primary key,
  supplier_name        text not null,
  is_priority_supplier boolean not null default false,
  contract_number      text not null unique,
  start_date           date not null,
  expiration_date      date not null,
  renewal_date         date not null,
  payment_terms        text not null
                         check (payment_terms in ('Net 15', 'Net 30', 'Net 45')),
  renewal_type         text not null default 'Auto-notify'
                         check (renewal_type in ('Manual', 'Auto-notify')),
  status               text not null default 'Active'
                         check (status in ('Active', 'Renewal in Progress', 'Expiring Soon', 'Critical', 'Expired')),
  pdf_url              text,
  archived             boolean not null default false,
  parent_contract_id   bigint references public.supplier_contracts (id),
  snooze_until         timestamptz,
  previous_status      text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           text
);

create index if not exists supplier_contracts_expiration_idx
  on public.supplier_contracts (expiration_date asc);
create index if not exists supplier_contracts_supplier_idx
  on public.supplier_contracts (supplier_name);
create index if not exists supplier_contracts_priority_idx
  on public.supplier_contracts (is_priority_supplier);

create table if not exists public.supplier_contract_history (
  id           bigint generated always as identity primary key,
  contract_id  bigint not null references public.supplier_contracts (id) on delete cascade,
  field_name   text not null,
  old_value    text,
  new_value    text,
  changed_at   timestamptz not null default now(),
  changed_by   text
);
create index if not exists supplier_contract_history_idx
  on public.supplier_contract_history (contract_id, changed_at desc);


-- ===========================================================================
-- 13. supplier_alert_settings + supplier_alert_log  (FR-16)
-- ===========================================================================
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

create table if not exists public.supplier_alert_log (
  id                bigint generated always as identity primary key,
  contract_id       bigint not null references public.supplier_contracts (id) on delete cascade,
  threshold_crossed integer,
  email_sent_at     timestamptz,
  dismissed_at      timestamptz,
  dismissed_by      text,
  action_taken      text check (action_taken in ('renew', 'renew_in_progress', 'manual_dismiss')),
  created_at        timestamptz not null default now()
);
create index if not exists supplier_alert_log_contract_idx
  on public.supplier_alert_log (contract_id, threshold_crossed);
create index if not exists supplier_alert_log_sent_idx
  on public.supplier_alert_log (contract_id, email_sent_at);


-- ===========================================================================
-- 14. audit_log  (FR-11 · trazabilidad de acciones críticas)
-- ===========================================================================
create table if not exists public.audit_log (
  id             bigint generated always as identity primary key,
  actor_email    text not null,
  actor_role     text,
  action         text not null,
  resource_type  text,
  resource_id    text,
  before_data    jsonb,
  after_data     jsonb,
  timestamp      timestamptz not null default now()
);
create index if not exists audit_log_timestamp_idx on public.audit_log (timestamp desc);
create index if not exists audit_log_actor_idx     on public.audit_log (actor_email);
create index if not exists audit_log_action_idx    on public.audit_log (action);


-- ===========================================================================
-- 15. users + role_mappings + app_config  (FR-11 · RBAC con Azure AD)
-- ===========================================================================
create table if not exists public.users (
  id              uuid primary key default gen_random_uuid(),
  email           text not null unique,
  full_name       text,
  upn             text,             -- Azure AD UPN
  azure_oid       text unique,      -- Azure Object ID (del JWT)
  roles           text[] not null default '{}',
  is_active       boolean not null default true,
  first_login_at  timestamptz not null default now(),
  last_login_at   timestamptz not null default now()
);

create table if not exists public.role_mappings (
  id                bigint generated always as identity primary key,
  azure_group_name  text not null unique,  -- nombre del grupo en Azure AD
  role_name         text not null,         -- 'Operations' | 'Finance' | 'Administrator'
  updated_at        timestamptz not null default now(),
  updated_by        text
);

-- Mappings por defecto (editar en Settings → Role Mappings para adaptarlos a los grupos reales)
insert into public.role_mappings (azure_group_name, role_name) values
  ('Contractors-Operations', 'Operations'),
  ('Contractors-Finance',    'Finance'),
  ('Contractors-Admin',      'Administrator')
on conflict (azure_group_name) do nothing;

create table if not exists public.app_config (
  id                     integer primary key default 1,
  permissions_enforced   boolean not null default false,
  session_max_hours      integer not null default 8,
  admin_bootstrap_email  text,     -- primer admin por email (antes de que existan grupos)
  updated_at             timestamptz not null default now(),
  updated_by             text,
  constraint app_config_singleton check (id = 1)
);
insert into public.app_config (id) values (1) on conflict (id) do nothing;


-- ===========================================================================
-- 16. TRIGGER FUNCTION: set_updated_at  (compartida por projects y supplier_contracts)
-- ===========================================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

drop trigger if exists supplier_contracts_set_updated_at on public.supplier_contracts;
create trigger supplier_contracts_set_updated_at
  before update on public.supplier_contracts
  for each row execute function public.set_updated_at();

-- Anti doble-pago del overage (migración 0037): al insertar un pago de overage,
-- ninguna de sus horas puede estar ya cubierta por otro pago de overage ni por
-- una factura. Enforcement del lado del pago; el reverso (facturar una hora de
-- overage) lo evita la app (allocations disjuntas). Ver 0037 para el detalle.
create index if not exists payments_entry_ids_gin
  on public.payments using gin (entry_ids);
create index if not exists invoices_entry_ids_gin
  on public.invoices using gin (entry_ids);

create or replace function public.payments_entry_ids_no_overlap()
returns trigger
language plpgsql
as $$
begin
  if new.entry_ids is null or array_length(new.entry_ids, 1) is null then
    return new;
  end if;
  -- Un advisory lock por hora (orden asc, sin deadlock): serializa sólo pagos que
  -- comparten horas; el EXISTS de un BEFORE-trigger no es atómico en READ COMMITTED.
  perform pg_advisory_xact_lock(eid)
  from (select distinct unnest(new.entry_ids) as eid) s
  order by s.eid;
  if exists (
    select 1 from public.payments p
    where p.id <> coalesce(new.id, -1)
      and p.entry_ids && new.entry_ids
  ) then
    raise exception 'hours already covered by another payment (entry_ids overlap)'
      using errcode = 'OV001';
  end if;
  -- Horas ya cubiertas por una factura (invoices.entry_ids; payments.entry_ids NULL).
  if exists (
    select 1 from public.invoices i
    where i.entry_ids && new.entry_ids
  ) then
    raise exception 'hours already covered by an invoice (entry_ids overlap)'
      using errcode = 'OV001';
  end if;
  return new;
end;
$$;

drop trigger if exists payments_entry_ids_no_overlap on public.payments;
create trigger payments_entry_ids_no_overlap
  before insert or update of entry_ids on public.payments
  for each row execute function public.payments_entry_ids_no_overlap();


-- ===========================================================================
-- 17. RPC: register_contractor_payment  (FR-10 · pago atómico al contractor)
--
-- Valida que la invoice esté en 'Collected', inserta el pago, avanza la
-- invoice a 'Paid' y registra la transición, todo en una sola transacción.
-- El índice único payments_invoice_id_unique impide pagos duplicados.
-- ===========================================================================
create or replace function public.register_contractor_payment(
  p_invoice_id         bigint,
  p_amount_paid        numeric,
  p_payment_date       date,
  p_transfer_reference text    default null,
  p_bank_method        text    default null,
  p_notes              text    default null,
  p_back_dated         boolean default false,
  p_created_by         text    default null,
  p_exchange_rate      numeric default null
)
returns setof public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id  bigint;
  v_status      text;
  v_currency    text;
begin
  -- Bloquear la fila para evitar concurrencia
  select status, currency
    into v_status, v_currency
    from public.invoices
   where id = p_invoice_id
     for update;

  if not found then
    raise exception 'Invoice % not found', p_invoice_id;
  end if;

  -- Pagable si Invoiced o Collected (flujo Billing → Payments; Collections no se
  -- usa por ahora, una factura emitida se paga directo). Ver migración 0036.
  if v_status not in ('Invoiced', 'Collected') then
    raise exception 'not_collected: invoice % is in status %, must be Invoiced or Collected',
      p_invoice_id, v_status;
  end if;

  -- Insertar el pago (el índice único rechazará un segundo pago)
  insert into public.payments (
    invoice_id, amount_paid, currency, exchange_rate,
    payment_date, transfer_reference, bank_method,
    notes, back_dated, created_by
  ) values (
    p_invoice_id, p_amount_paid, coalesce(v_currency, 'USD'), p_exchange_rate,
    p_payment_date, p_transfer_reference, p_bank_method,
    p_notes, p_back_dated, p_created_by
  )
  returning id into v_payment_id;

  -- Avanzar la invoice a 'Paid'
  update public.invoices set status = 'Paid' where id = p_invoice_id;

  -- Registrar en historial
  insert into public.invoice_status_history
    (invoice_id, from_status, to_status, changed_by, note)
  values
    (p_invoice_id, v_status, 'Paid', p_created_by, 'Contractor payment registered');

  return query select * from public.payments where id = v_payment_id;
end;
$$;

-- Solo usuarios autenticados pueden llamar esta función
revoke all on function public.register_contractor_payment from public;
grant execute on function public.register_contractor_payment to authenticated;


-- ===========================================================================
-- 18. RPC: provision_current_user  (FR-11 · JIT provisioning con Azure AD)
--
-- Llamada desde la app en cada login. Lee el JWT de Azure AD, mapea grupos
-- a roles de la app (via role_mappings) y hace upsert del usuario.
-- Devuelve el registro del usuario con sus roles efectivos.
--
-- IMPORTANTE: Los grupos de Azure AD deben estar habilitados en el JWT.
-- En Azure Portal → App registrations → Token configuration → Add groups claim.
-- En Supabase Dashboard → Authentication → Providers → Azure → habilitar.
-- ===========================================================================
create or replace function public.provision_current_user()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id    uuid;
  v_email      text;
  v_full_name  text;
  v_oid        text;
  v_upn        text;
  v_groups     text[];
  v_roles      text[];
  v_row        public.users;
  v_jwt        jsonb;
  v_user_count integer;
  v_cfg        public.app_config;
begin
  v_jwt      := auth.jwt();
  v_user_id  := auth.uid();
  v_email    := coalesce(v_jwt ->> 'email', v_jwt ->> 'preferred_username');
  v_full_name:= coalesce(v_jwt ->> 'name', v_jwt ->> 'full_name', v_email);
  v_oid      := coalesce(v_jwt ->> 'oid', v_jwt ->> 'sub', v_user_id::text);
  v_upn      := coalesce(v_jwt ->> 'upn', v_jwt ->> 'preferred_username', v_email);

  -- Grupos de Azure AD en el claim 'groups' (array de GUIDs o nombres)
  begin
    v_groups := array(
      select jsonb_array_elements_text(v_jwt -> 'groups')
    );
  exception when others then
    v_groups := '{}';
  end;

  -- Mapear grupos → roles
  select array_agg(distinct rm.role_name)
    into v_roles
    from public.role_mappings rm
   where rm.azure_group_name = any(v_groups);

  v_roles := coalesce(v_roles, '{}');

  -- Bootstrap: primer usuario o email de admin explícito → Administrator
  select * into v_cfg from public.app_config where id = 1;
  select count(*) into v_user_count from public.users;

  if array_length(v_roles, 1) is null then
    if v_user_count = 0
       or (v_cfg.admin_bootstrap_email is not null
           and lower(v_email) = lower(v_cfg.admin_bootstrap_email))
    then
      v_roles := array['Administrator'];
    end if;
  end if;

  -- Upsert del usuario (por Supabase auth.uid, que no cambia)
  insert into public.users (
    id, email, full_name, upn, azure_oid, roles, is_active, first_login_at, last_login_at
  ) values (
    v_user_id, v_email, v_full_name, v_upn, v_oid, v_roles, true, now(), now()
  )
  on conflict (id) do update set
    email         = excluded.email,
    full_name     = excluded.full_name,
    upn           = excluded.upn,
    azure_oid     = excluded.azure_oid,
    roles         = excluded.roles,
    last_login_at = now();

  select * into v_row from public.users where id = v_user_id;
  return row_to_json(v_row)::jsonb;
end;
$$;

revoke all on function public.provision_current_user from public;
grant execute on function public.provision_current_user to authenticated;


-- ===========================================================================
-- 19. VIEWS
-- ===========================================================================

-- Vista de cobros totales por factura
create or replace view public.invoice_collection_totals
  with (security_invoker = true)
as
  select
    i.id                                    as invoice_id,
    i.total_amount,
    coalesce(sum(c.amount_received), 0)     as amount_collected,
    i.total_amount - coalesce(sum(c.amount_received), 0) as outstanding
  from public.invoices i
  left join public.collections c on c.invoice_id = i.id
  group by i.id, i.total_amount;


-- Vista de trazabilidad completa (time entry → invoice → collections → payment)
create or replace view public.trace_view
  with (security_invoker = true)
as
  select
    -- Time Entry
    te.id                                       as time_entry_id,
    te.zoho_log_id,
    te.user_name,
    te.log_date,
    te.hours,
    te.client,
    te.project,
    te.task,
    te.description,
    te.status                                   as zoho_status,
    te.synced_at,
    -- Invoice
    i.id                                        as invoice_id,
    i.supplier_invoice_number,
    i.invoice_date,
    i.total_amount                              as invoice_amount,
    i.status                                    as invoice_status,
    i.currency                                  as invoice_currency,
    i.payment_terms_days,
    i.created_at                                as invoiced_at,
    i.created_by                                as invoiced_by,
    -- Collections (agregadas)
    coalesce(ca.amount_collected, 0)            as collected_amount,
    ca.last_collection_date,
    coalesce(ca.collection_count, 0)            as collection_count,
    -- Payment al contractor
    p.id                                        as payment_id,
    p.amount_paid,
    p.payment_date,
    p.transfer_reference,
    p.bank_method,
    p.notes                                     as payment_notes,
    p.created_at                                as paid_at,
    p.created_by                                as paid_by
  from public.time_entries te
  left join public.invoices i
    on i.entry_ids @> array[te.id]
  left join (
    select
      invoice_id,
      sum(amount_received)  as amount_collected,
      max(collection_date)  as last_collection_date,
      count(*)              as collection_count
    from public.collections
    group by invoice_id
  ) ca on ca.invoice_id = i.id
  left join public.payments p on p.invoice_id = i.id;


-- ===========================================================================
-- 20. ROW LEVEL SECURITY (RLS)
-- ===========================================================================
-- Estrategia: usuarios autenticados (Azure AD OAuth vía Supabase) pueden
-- leer y operar todo. Nadie puede borrar filas (se conserva historial).
-- Las Edge Functions operan con service_role (bypassa RLS por diseño).

alter table public.time_entries           enable row level security;
alter table public.invoices               enable row level security;
alter table public.invoice_status_history enable row level security;
alter table public.payments               enable row level security;
alter table public.sync_status            enable row level security;
alter table public.sync_log               enable row level security;
alter table public.projects               enable row level security;
alter table public.project_history        enable row level security;
alter table public.contract_alert_settings enable row level security;
alter table public.contract_alert_log     enable row level security;
alter table public.email_outbox           enable row level security;
alter table public.collections            enable row level security;
alter table public.collection_alert_settings enable row level security;
alter table public.payment_alert_settings enable row level security;
alter table public.supplier_contracts     enable row level security;
alter table public.supplier_contract_history enable row level security;
alter table public.supplier_alert_settings enable row level security;
alter table public.supplier_alert_log     enable row level security;
alter table public.audit_log              enable row level security;
alter table public.users                  enable row level security;
alter table public.role_mappings          enable row level security;
alter table public.app_config             enable row level security;

-- ── time_entries ─────────────────────────────────────────────────────────────
drop policy if exists "auth read time_entries"  on public.time_entries;
create policy "auth read time_entries"  on public.time_entries
  for select to authenticated using (true);

-- ── invoices ──────────────────────────────────────────────────────────────────
drop policy if exists "auth read invoices"   on public.invoices;
create policy "auth read invoices"   on public.invoices
  for select to authenticated using (true);
drop policy if exists "auth insert invoices" on public.invoices;
create policy "auth insert invoices" on public.invoices
  for insert to authenticated with check (true);
drop policy if exists "auth update invoices" on public.invoices;
create policy "auth update invoices" on public.invoices
  for update to authenticated using (true) with check (true);

-- ── invoice_status_history ───────────────────────────────────────────────────
drop policy if exists "auth read inv_history"   on public.invoice_status_history;
create policy "auth read inv_history"   on public.invoice_status_history
  for select to authenticated using (true);
drop policy if exists "auth insert inv_history" on public.invoice_status_history;
create policy "auth insert inv_history" on public.invoice_status_history
  for insert to authenticated with check (true);

-- ── payments ──────────────────────────────────────────────────────────────────
-- La inserción va por la función register_contractor_payment (service_role),
-- pero igualmente se permite desde authenticated como fallback.
drop policy if exists "auth read payments"   on public.payments;
create policy "auth read payments"   on public.payments
  for select to authenticated using (true);
drop policy if exists "auth insert payments" on public.payments;
create policy "auth insert payments" on public.payments
  for insert to authenticated with check (true);

-- ── sync_status / sync_log ───────────────────────────────────────────────────
drop policy if exists "auth read sync_status" on public.sync_status;
create policy "auth read sync_status" on public.sync_status
  for select to authenticated using (true);
drop policy if exists "auth read sync_log" on public.sync_log;
create policy "auth read sync_log" on public.sync_log
  for select to authenticated using (true);

-- ── projects ──────────────────────────────────────────────────────────────────
drop policy if exists "auth read projects"   on public.projects;
create policy "auth read projects"   on public.projects
  for select to authenticated using (true);
drop policy if exists "auth insert projects" on public.projects;
create policy "auth insert projects" on public.projects
  for insert to authenticated with check (true);
drop policy if exists "auth update projects" on public.projects;
create policy "auth update projects" on public.projects
  for update to authenticated using (true) with check (true);

-- ── project_history ───────────────────────────────────────────────────────────
drop policy if exists "auth read project_history"   on public.project_history;
create policy "auth read project_history"   on public.project_history
  for select to authenticated using (true);
drop policy if exists "auth insert project_history" on public.project_history;
create policy "auth insert project_history" on public.project_history
  for insert to authenticated with check (true);

-- ── contract_alert_settings ──────────────────────────────────────────────────
drop policy if exists "auth read contract_alert_settings"   on public.contract_alert_settings;
create policy "auth read contract_alert_settings"   on public.contract_alert_settings
  for select to authenticated using (true);
drop policy if exists "auth update contract_alert_settings" on public.contract_alert_settings;
create policy "auth update contract_alert_settings" on public.contract_alert_settings
  for update to authenticated using (true) with check (true);

-- ── contract_alert_log ───────────────────────────────────────────────────────
drop policy if exists "auth read contract_alert_log" on public.contract_alert_log;
create policy "auth read contract_alert_log" on public.contract_alert_log
  for select to authenticated using (true);

-- ── email_outbox ─────────────────────────────────────────────────────────────
drop policy if exists "auth read email_outbox"   on public.email_outbox;
create policy "auth read email_outbox"   on public.email_outbox
  for select to authenticated using (true);
drop policy if exists "auth update email_outbox" on public.email_outbox;
create policy "auth update email_outbox" on public.email_outbox
  for update to authenticated using (true) with check (true);

-- ── collections ───────────────────────────────────────────────────────────────
drop policy if exists "auth read collections"   on public.collections;
create policy "auth read collections"   on public.collections
  for select to authenticated using (true);
drop policy if exists "auth insert collections" on public.collections;
create policy "auth insert collections" on public.collections
  for insert to authenticated with check (true);

-- ── collection_alert_settings ────────────────────────────────────────────────
drop policy if exists "auth read collection_alert_settings"   on public.collection_alert_settings;
create policy "auth read collection_alert_settings"   on public.collection_alert_settings
  for select to authenticated using (true);
drop policy if exists "auth update collection_alert_settings" on public.collection_alert_settings;
create policy "auth update collection_alert_settings" on public.collection_alert_settings
  for update to authenticated using (true) with check (true);

-- ── payment_alert_settings ───────────────────────────────────────────────────
drop policy if exists "auth read payment_alert_settings"   on public.payment_alert_settings;
create policy "auth read payment_alert_settings"   on public.payment_alert_settings
  for select to authenticated using (true);
drop policy if exists "auth update payment_alert_settings" on public.payment_alert_settings;
create policy "auth update payment_alert_settings" on public.payment_alert_settings
  for update to authenticated using (true) with check (true);

-- ── supplier_contracts ────────────────────────────────────────────────────────
drop policy if exists "auth read supplier_contracts"   on public.supplier_contracts;
create policy "auth read supplier_contracts"   on public.supplier_contracts
  for select to authenticated using (true);
drop policy if exists "auth insert supplier_contracts" on public.supplier_contracts;
create policy "auth insert supplier_contracts" on public.supplier_contracts
  for insert to authenticated with check (true);
drop policy if exists "auth update supplier_contracts" on public.supplier_contracts;
create policy "auth update supplier_contracts" on public.supplier_contracts
  for update to authenticated using (true) with check (true);

-- ── supplier_contract_history ────────────────────────────────────────────────
drop policy if exists "auth read supplier_contract_history"   on public.supplier_contract_history;
create policy "auth read supplier_contract_history"   on public.supplier_contract_history
  for select to authenticated using (true);
drop policy if exists "auth insert supplier_contract_history" on public.supplier_contract_history;
create policy "auth insert supplier_contract_history" on public.supplier_contract_history
  for insert to authenticated with check (true);

-- ── supplier_alert_settings ──────────────────────────────────────────────────
drop policy if exists "auth read supplier_alert_settings"   on public.supplier_alert_settings;
create policy "auth read supplier_alert_settings"   on public.supplier_alert_settings
  for select to authenticated using (true);
drop policy if exists "auth update supplier_alert_settings" on public.supplier_alert_settings;
create policy "auth update supplier_alert_settings" on public.supplier_alert_settings
  for update to authenticated using (true) with check (true);

-- ── supplier_alert_log ───────────────────────────────────────────────────────
drop policy if exists "auth read supplier_alert_log"   on public.supplier_alert_log;
create policy "auth read supplier_alert_log"   on public.supplier_alert_log
  for select to authenticated using (true);
drop policy if exists "auth insert supplier_alert_log" on public.supplier_alert_log;
create policy "auth insert supplier_alert_log" on public.supplier_alert_log
  for insert to authenticated with check (true);

-- ── audit_log ────────────────────────────────────────────────────────────────
drop policy if exists "auth read audit_log"   on public.audit_log;
create policy "auth read audit_log"   on public.audit_log
  for select to authenticated using (true);
drop policy if exists "auth insert audit_log" on public.audit_log;
create policy "auth insert audit_log" on public.audit_log
  for insert to authenticated with check (true);

-- ── users ────────────────────────────────────────────────────────────────────
-- Sólo puede leer/editar el propio registro (provision_current_user usa SECURITY DEFINER)
drop policy if exists "auth read users"   on public.users;
create policy "auth read users"   on public.users
  for select to authenticated using (true);

-- ── role_mappings ─────────────────────────────────────────────────────────────
drop policy if exists "auth read role_mappings"   on public.role_mappings;
create policy "auth read role_mappings"   on public.role_mappings
  for select to authenticated using (true);
drop policy if exists "auth update role_mappings" on public.role_mappings;
create policy "auth update role_mappings" on public.role_mappings
  for update to authenticated using (true) with check (true);
drop policy if exists "auth insert role_mappings" on public.role_mappings;
create policy "auth insert role_mappings" on public.role_mappings
  for insert to authenticated with check (true);

-- ── app_config ────────────────────────────────────────────────────────────────
drop policy if exists "auth read app_config"   on public.app_config;
create policy "auth read app_config"   on public.app_config
  for select to authenticated using (true);
drop policy if exists "auth update app_config" on public.app_config;
create policy "auth update app_config" on public.app_config
  for update to authenticated using (true) with check (true);


-- ===========================================================================
-- 21. STORAGE — bucket 'supplier-contracts' (PDFs de contratos)
-- ===========================================================================
insert into storage.buckets (id, name, public)
values ('supplier-contracts', 'supplier-contracts', false)
on conflict (id) do nothing;

drop policy if exists "auth upload supplier-contracts" on storage.objects;
create policy "auth upload supplier-contracts" on storage.objects
  for insert to authenticated with check (bucket_id = 'supplier-contracts');

drop policy if exists "auth read supplier-contracts" on storage.objects;
create policy "auth read supplier-contracts" on storage.objects
  for select to authenticated using (bucket_id = 'supplier-contracts');

drop policy if exists "auth update supplier-contracts" on storage.objects;
create policy "auth update supplier-contracts" on storage.objects
  for update to authenticated using (bucket_id = 'supplier-contracts')
  with check (bucket_id = 'supplier-contracts');


-- ===========================================================================
-- 22. pg_cron JOBS
-- INSTRUCCIONES:
--   1. Activar extensiones pg_cron y pg_net en Database → Extensions
--   2. Reemplazar <PROJECT_REF> con el ID de tu proyecto Supabase
--      (lo encontrás en Settings → General → Reference ID)
--   3. Reemplazar <SERVICE_ROLE_KEY> con la service_role key
--      (Settings → API → service_role key — ¡nunca la expongas en el frontend!)
--   4. Ejecutar cada bloque select cron.schedule(...) por separado
-- ===========================================================================

-- Alertas de contratos de cliente (08:00 UTC todos los días)
/*
select cron.schedule(
  'project-contract-alerts-daily',
  '0 8 * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/project-contract-alerts',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
      'Content-Type',  'application/json'
    )
  );
  $$
);
*/

-- Alertas de cobros pendientes (09:00 UTC todos los días)
/*
select cron.schedule(
  'collection-alerts-daily',
  '0 9 * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/collection-alerts',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
      'Content-Type',  'application/json'
    )
  );
  $$
);
*/

-- Alertas de pagos a contractor (10:00 UTC todos los días)
/*
select cron.schedule(
  'payment-alerts-daily',
  '0 10 * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/payment-alerts',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
      'Content-Type',  'application/json'
    )
  );
  $$
);
*/

-- Alertas de supplier contracts (08:30 UTC todos los días)
/*
select cron.schedule(
  'supplier-contract-alerts-daily',
  '30 8 * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/supplier-contract-alerts',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
      'Content-Type',  'application/json'
    )
  );
  $$
);
*/

-- Procesamiento del email_outbox vía Resend (cada 5 minutos)
/*
select cron.schedule(
  'process-email-outbox',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/process-email-outbox',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
      'Content-Type',  'application/json'
    )
  );
  $$
);
*/


-- ===========================================================================
-- FIN DEL SCHEMA
-- ===========================================================================
-- VARIABLES DE ENTORNO QUE DEBES CONFIGURAR:
--
-- En Vercel → Settings → Environment Variables:
--   VITE_SUPABASE_URL         = https://<PROJECT_REF>.supabase.co
--   VITE_SUPABASE_ANON_KEY    = <anon key de Settings → API>
--   VITE_AZURE_CLIENT_ID      = <Application (client) ID de Azure>
--   VITE_AZURE_TENANT_ID      = <Directory (tenant) ID de Azure>
--   VITE_AZURE_REDIRECT_URI   = https://<tu-dominio-vercel>.vercel.app
--
-- En Supabase → Edge Functions → Secrets:
--   ZOHO_CLIENT_ID            = <Client ID de Zoho API Console>
--   ZOHO_CLIENT_SECRET        = <Client Secret de Zoho API Console>
--   ZOHO_REFRESH_TOKEN        = <Refresh token obtenido con OAuth>
--   RESEND_API_KEY            = re_... (desde resend.com → API Keys)
--
-- SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son inyectadas automáticamente
-- por Supabase en todas las Edge Functions — no hace falta agregarlas.
-- ===========================================================================
