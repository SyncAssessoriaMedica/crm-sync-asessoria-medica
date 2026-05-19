-- ============================================================
-- CRM Sync Marketing — Migration 001: Schema inicial multi-tenant
-- ============================================================

-- Enable necessary extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pg_trgm"; -- full-text search

-- ─── ORGANIZATIONS / TENANTS ─────────────────────────────────────────────────

create table if not exists organizations (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  slug        text not null unique,
  logo_url    text,
  subscription_status text not null default 'trial'
    check (subscription_status in ('trial','active','suspended','cancelled')),
  subscription_expires_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_organizations_slug on organizations(slug);
create index idx_organizations_status on organizations(subscription_status);

-- ─── PROFILES (extends Supabase auth.users) ──────────────────────────────────

create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text not null,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─── ORGANIZATION MEMBERS ─────────────────────────────────────────────────────

create type user_role as enum (
  'super_admin',
  'gestor_sync',
  'admin_clinica',
  'atendente',
  'leitura'
);

create table if not exists organization_members (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id         uuid not null references profiles(id) on delete cascade,
  role            user_role not null default 'atendente',
  created_at      timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index idx_members_org on organization_members(organization_id);
create index idx_members_user on organization_members(user_id);

-- ─── LEAD SOURCES ─────────────────────────────────────────────────────────────

create table if not exists lead_sources (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,
  color           text,
  created_at      timestamptz not null default now()
);

create index idx_lead_sources_org on lead_sources(organization_id);

-- ─── CAMPAIGNS ───────────────────────────────────────────────────────────────

create table if not exists campaigns (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,
  platform        text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_campaigns_org on campaigns(organization_id);

-- ─── PIPELINES & STAGES ──────────────────────────────────────────────────────

create table if not exists pipelines (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,
  is_default      boolean not null default false,
  created_at      timestamptz not null default now()
);

create index idx_pipelines_org on pipelines(organization_id);

create table if not exists pipeline_stages (
  id          uuid primary key default uuid_generate_v4(),
  pipeline_id uuid not null references pipelines(id) on delete cascade,
  name        text not null,
  "order"     int not null,
  color       text,
  created_at  timestamptz not null default now()
);

create index idx_stages_pipeline on pipeline_stages(pipeline_id);

-- ─── TAGS ────────────────────────────────────────────────────────────────────

create table if not exists tags (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,
  color           text not null default '#22c55e',
  created_at      timestamptz not null default now()
);

create index idx_tags_org on tags(organization_id);

-- ─── LEADS ───────────────────────────────────────────────────────────────────

create type lead_status as enum (
  'new',
  'contacted',
  'qualified',
  'scheduled',
  'attended',
  'closed_won',
  'closed_lost',
  'no_show'
);

create table if not exists leads (
  id                    uuid primary key default uuid_generate_v4(),
  organization_id       uuid not null references organizations(id) on delete cascade,
  name                  text not null,
  phone                 text not null,
  email                 text,
  source_id             uuid references lead_sources(id) on delete set null,
  campaign_id           uuid references campaigns(id) on delete set null,
  procedure             text,
  stage_id              uuid references pipeline_stages(id) on delete set null,
  assignee_id           uuid references profiles(id) on delete set null,
  status                lead_status not null default 'new',
  potential_value       numeric(12,2),
  closed_value          numeric(12,2),
  observations          text,
  next_action_at        timestamptz,
  next_action_note      text,
  last_interaction_at   timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index idx_leads_org on leads(organization_id);
create index idx_leads_phone on leads(organization_id, phone);
create index idx_leads_status on leads(organization_id, status);
create index idx_leads_stage on leads(stage_id);
create index idx_leads_assignee on leads(assignee_id);
create index idx_leads_created on leads(organization_id, created_at desc);
-- Full text search
create index idx_leads_fts on leads using gin(to_tsvector('portuguese', name || ' ' || coalesce(email,'') || ' ' || coalesce(procedure,'')));

-- ─── LEAD TAGS ───────────────────────────────────────────────────────────────

create table if not exists lead_tags (
  lead_id uuid not null references leads(id) on delete cascade,
  tag_id  uuid not null references tags(id) on delete cascade,
  primary key (lead_id, tag_id)
);

create index idx_lead_tags_lead on lead_tags(lead_id);

-- ─── LEAD NOTES ──────────────────────────────────────────────────────────────

create table if not exists lead_notes (
  id          uuid primary key default uuid_generate_v4(),
  lead_id     uuid not null references leads(id) on delete cascade,
  author_id   uuid references profiles(id) on delete set null,
  content     text not null,
  created_at  timestamptz not null default now()
);

create index idx_notes_lead on lead_notes(lead_id);

-- ─── LEAD EVENTS (timeline) ──────────────────────────────────────────────────

create table if not exists lead_events (
  id            uuid primary key default uuid_generate_v4(),
  lead_id       uuid not null references leads(id) on delete cascade,
  actor_id      uuid references profiles(id) on delete set null,
  event_type    text not null,
  description   text not null,
  metadata      jsonb,
  created_at    timestamptz not null default now()
);

create index idx_events_lead on lead_events(lead_id, created_at desc);

-- ─── LEAD TASKS ──────────────────────────────────────────────────────────────

create table if not exists lead_tasks (
  id            uuid primary key default uuid_generate_v4(),
  lead_id       uuid not null references leads(id) on delete cascade,
  assignee_id   uuid references profiles(id) on delete set null,
  title         text not null,
  due_at        timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index idx_tasks_lead on lead_tasks(lead_id);
create index idx_tasks_assignee on lead_tasks(assignee_id);

-- ─── CUSTOM FIELDS ───────────────────────────────────────────────────────────

create type custom_field_type as enum (
  'text','number','date','select','multiselect','boolean','url'
);

create table if not exists custom_fields (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,
  key             text not null,
  field_type      custom_field_type not null default 'text',
  options         text[],
  required        boolean not null default false,
  "order"         int not null default 0,
  created_at      timestamptz not null default now(),
  unique (organization_id, key)
);

create index idx_custom_fields_org on custom_fields(organization_id);

create table if not exists custom_field_values (
  id              uuid primary key default uuid_generate_v4(),
  lead_id         uuid not null references leads(id) on delete cascade,
  field_id        uuid not null references custom_fields(id) on delete cascade,
  value           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (lead_id, field_id)
);

create index idx_cfv_lead on custom_field_values(lead_id);

-- ─── WHATSAPP INSTANCES ──────────────────────────────────────────────────────

create type wa_status as enum ('connected','disconnected','connecting');

create table if not exists whatsapp_instances (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id) on delete cascade,
  instance_name   text not null,
  phone_number    text,
  status          wa_status not null default 'disconnected',
  evolution_key   text, -- API key para esta instância
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_wa_instances_org on whatsapp_instances(organization_id);

-- ─── CONVERSATIONS ───────────────────────────────────────────────────────────

create type conversation_status as enum ('open','closed','archived');

create table if not exists conversations (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id) on delete cascade,
  lead_id         uuid references leads(id) on delete set null,
  instance_id     uuid references whatsapp_instances(id) on delete cascade,
  remote_jid      text not null, -- ex: "5511987654321@s.whatsapp.net"
  assignee_id     uuid references profiles(id) on delete set null,
  unread_count    int not null default 0,
  status          conversation_status not null default 'open',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (instance_id, remote_jid)
);

create index idx_conversations_org on conversations(organization_id, updated_at desc);
create index idx_conversations_lead on conversations(lead_id);

-- ─── MESSAGES ────────────────────────────────────────────────────────────────

create type message_type as enum (
  'text','image','audio','video','document','sticker','location'
);
create type message_direction as enum ('inbound','outbound');

create table if not exists messages (
  id                uuid primary key default uuid_generate_v4(),
  conversation_id   uuid not null references conversations(id) on delete cascade,
  evolution_msg_id  text unique, -- ID do message na Evolution API
  direction         message_direction not null,
  message_type      message_type not null default 'text',
  content           text,
  media_url         text,
  media_mimetype    text,
  media_filename    text,
  media_duration    int, -- segundos (para audio/video)
  sent_by_id        uuid references profiles(id) on delete set null,
  delivered_at      timestamptz,
  read_at           timestamptz,
  created_at        timestamptz not null default now()
);

create index idx_messages_conversation on messages(conversation_id, created_at);
create index idx_messages_evolution_id on messages(evolution_msg_id);

-- ─── SUBSCRIPTIONS / BILLING ─────────────────────────────────────────────────

create table if not exists billing_accounts (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id) on delete cascade,
  plan            text not null default 'trial',
  status          text not null default 'active'
    check (status in ('active','suspended','cancelled')),
  trial_ends_at   timestamptz,
  current_period_start timestamptz,
  current_period_end   timestamptz,
  payment_method  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_billing_org on billing_accounts(organization_id);

-- ─── AUDIT LOGS ──────────────────────────────────────────────────────────────

create table if not exists audit_logs (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid references organizations(id) on delete set null,
  actor_id        uuid references profiles(id) on delete set null,
  action          text not null,
  resource_type   text not null,
  resource_id     uuid,
  metadata        jsonb,
  ip_address      inet,
  created_at      timestamptz not null default now()
);

create index idx_audit_org on audit_logs(organization_id, created_at desc);
create index idx_audit_actor on audit_logs(actor_id);

-- ─── WEBHOOK EVENTS ──────────────────────────────────────────────────────────

create table if not exists webhook_events (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid references organizations(id) on delete set null,
  source          text not null, -- 'leads_endpoint' | 'evolution'
  event_type      text,
  payload         jsonb not null,
  processed       boolean not null default false,
  error           text,
  created_at      timestamptz not null default now()
);

create index idx_webhook_events_org on webhook_events(organization_id, created_at desc);
create index idx_webhook_events_processed on webhook_events(processed, created_at);

-- ─── UPDATED_AT trigger ──────────────────────────────────────────────────────

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_organizations_updated_at
  before update on organizations
  for each row execute function update_updated_at();

create trigger trg_leads_updated_at
  before update on leads
  for each row execute function update_updated_at();

create trigger trg_conversations_updated_at
  before update on conversations
  for each row execute function update_updated_at();

create trigger trg_wa_instances_updated_at
  before update on whatsapp_instances
  for each row execute function update_updated_at();

create trigger trg_billing_updated_at
  before update on billing_accounts
  for each row execute function update_updated_at();
