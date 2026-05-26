-- ============================================================
-- CRM Sync Marketing - Migration 014
-- Business-hours auto-reply queue
-- ============================================================

-- Distinguish automated message types (bh_auto_reply, followup, etc.)
alter table messages
  add column if not exists automation_type text null;

-- Per-org settings for the business-hours auto-reply feature.
create table if not exists bh_auto_reply_settings (
  organization_id  uuid        primary key references organizations(id) on delete cascade,
  enabled          boolean     not null default false,
  message_template text        not null default 'Ola! Estamos fora do horario de atendimento no momento. O proximo horario disponivel e {{proximo_horario_util}}. Entraremos em contato assim que possivel!',
  delay_minutes    integer     not null default 15 check (delay_minutes between 1 and 120),
  cooldown_hours   integer     not null default 12 check (cooldown_hours between 1 and 168),
  timezone         text        not null default 'America/Sao_Paulo',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

drop trigger if exists trg_bh_reply_settings_updated_at on bh_auto_reply_settings;
create trigger trg_bh_reply_settings_updated_at
  before update on bh_auto_reply_settings
  for each row execute function update_updated_at();

alter table bh_auto_reply_settings enable row level security;

drop policy if exists "bh_reply_settings_select" on bh_auto_reply_settings;
drop policy if exists "bh_reply_settings_insert" on bh_auto_reply_settings;
drop policy if exists "bh_reply_settings_update" on bh_auto_reply_settings;
drop policy if exists "bh_reply_settings_delete" on bh_auto_reply_settings;

create policy "bh_reply_settings_select" on bh_auto_reply_settings for select
  using (
    is_sync_staff()
    or organization_id in (select * from get_user_org_ids())
  );

create policy "bh_reply_settings_insert" on bh_auto_reply_settings for insert
  with check (
    is_sync_staff()
    or (
      organization_id in (select * from get_user_org_ids())
      and get_user_role_in_org(organization_id) = 'admin_clinica'
    )
  );

create policy "bh_reply_settings_update" on bh_auto_reply_settings for update
  using (
    is_sync_staff()
    or (
      organization_id in (select * from get_user_org_ids())
      and get_user_role_in_org(organization_id) = 'admin_clinica'
    )
  )
  with check (
    is_sync_staff()
    or (
      organization_id in (select * from get_user_org_ids())
      and get_user_role_in_org(organization_id) = 'admin_clinica'
    )
  );

create policy "bh_reply_settings_delete" on bh_auto_reply_settings for delete
  using (is_sync_staff());

-- Queue table for pending auto-replies. At most one active item per conversation.
create table if not exists bh_auto_reply_queue (
  id               uuid                  primary key default uuid_generate_v4(),
  organization_id  uuid                  not null references organizations(id) on delete cascade,
  conversation_id  uuid                  not null references conversations(id) on delete cascade,
  lead_id          uuid                  null references leads(id) on delete set null,
  trigger_message_id uuid                 null references messages(id) on delete set null,
  scheduled_for    timestamptz           not null,
  status           followup_queue_status not null default 'pending',
  message_sent     text                  null,
  message_id       uuid                  null references messages(id) on delete set null,
  sent_at          timestamptz           null,
  cancel_reason    text                  null,
  error            text                  null,
  created_at       timestamptz           not null default now(),
  updated_at       timestamptz           not null default now()
);

create index if not exists idx_bh_auto_reply_pending
  on bh_auto_reply_queue(organization_id, scheduled_for)
  where status = 'pending';

-- Enforce exactly one active (pending or sending) item per conversation.
create unique index if not exists idx_bh_auto_reply_one_active
  on bh_auto_reply_queue(conversation_id)
  where status in ('pending', 'sending');

drop trigger if exists trg_bh_auto_reply_queue_updated_at on bh_auto_reply_queue;
create trigger trg_bh_auto_reply_queue_updated_at
  before update on bh_auto_reply_queue
  for each row execute function update_updated_at();

alter table bh_auto_reply_queue enable row level security;

drop policy if exists "bh_reply_queue_select" on bh_auto_reply_queue;
drop policy if exists "bh_reply_queue_insert" on bh_auto_reply_queue;
drop policy if exists "bh_reply_queue_update" on bh_auto_reply_queue;
drop policy if exists "bh_reply_queue_delete" on bh_auto_reply_queue;

create policy "bh_reply_queue_select" on bh_auto_reply_queue for select
  using (
    is_sync_staff()
    or organization_id in (select * from get_user_org_ids())
  );

create policy "bh_reply_queue_insert" on bh_auto_reply_queue for insert
  with check (
    is_sync_staff()
    or organization_id in (select * from get_user_org_ids())
  );

create policy "bh_reply_queue_update" on bh_auto_reply_queue for update
  using (
    is_sync_staff()
    or organization_id in (select * from get_user_org_ids())
  )
  with check (
    is_sync_staff()
    or organization_id in (select * from get_user_org_ids())
  );

create policy "bh_reply_queue_delete" on bh_auto_reply_queue for delete
  using (
    is_sync_staff()
    or organization_id in (select * from get_user_org_ids())
  );
