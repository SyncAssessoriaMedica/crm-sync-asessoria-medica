-- ============================================================
-- CRM Sync Marketing — Migration 010: Follow-up Automático
-- ============================================================

-- ─── ENUMS ───────────────────────────────────────────────────────────────────

do $$
begin
  create type followup_queue_status as enum (
    'pending',   -- created, waiting for scheduled_for
    'sending',   -- being processed right now (lock)
    'sent',      -- successfully sent
    'skipped',   -- blocked (paused lead, blocked stage/tag)
    'failed',    -- Evolution API error
    'cancelled'  -- lead replied / cycle reset
  );
exception
  when duplicate_object then null;
end $$;

-- ─── FOLLOWUP_SETTINGS ───────────────────────────────────────────────────────
-- One row per organization (upserted on save).

create table if not exists followup_settings (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id) on delete cascade,
  enabled         boolean not null default false,
  timezone        text    not null default 'America/Sao_Paulo',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id)
);

create index idx_followup_settings_org on followup_settings(organization_id);

-- ─── FOLLOWUP_STEPS ──────────────────────────────────────────────────────────
-- Ordered sequence of messages. delay_days counts from cycle_started_at.

create table if not exists followup_steps (
  id               uuid primary key default uuid_generate_v4(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  step_order       integer not null,
  delay_days       integer not null check (delay_days >= 1),
  message_template text    not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, step_order)
);

create index idx_followup_steps_org on followup_steps(organization_id, step_order);

-- ─── FOLLOWUP_BUSINESS_HOURS ─────────────────────────────────────────────────
-- Per-day window when follow-ups may be sent (cron respects timezone from settings).
-- day_of_week: 0 = Sunday, 6 = Saturday.

create table if not exists followup_business_hours (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id) on delete cascade,
  day_of_week     integer not null check (day_of_week between 0 and 6),
  start_time      time    not null default '08:00',
  end_time        time    not null default '18:00',
  enabled         boolean not null default true,
  unique (organization_id, day_of_week)
);

create index idx_followup_hours_org on followup_business_hours(organization_id);

-- ─── FOLLOWUP_BLOCKED_STAGES ─────────────────────────────────────────────────

create table if not exists followup_blocked_stages (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id) on delete cascade,
  stage_id        uuid not null references pipeline_stages(id) on delete cascade,
  unique (organization_id, stage_id)
);

create index idx_followup_blocked_stages_org on followup_blocked_stages(organization_id);

-- ─── FOLLOWUP_BLOCKED_TAGS ───────────────────────────────────────────────────

create table if not exists followup_blocked_tags (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id) on delete cascade,
  tag_id          uuid not null references tags(id) on delete cascade,
  unique (organization_id, tag_id)
);

create index idx_followup_blocked_tags_org on followup_blocked_tags(organization_id);

-- ─── FOLLOWUP_QUEUE ──────────────────────────────────────────────────────────

create table if not exists followup_queue (
  id                uuid primary key default uuid_generate_v4(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  conversation_id   uuid not null references conversations(id) on delete cascade,
  lead_id           uuid references leads(id) on delete set null,
  step_id           uuid not null references followup_steps(id) on delete cascade,
  cycle_started_at  timestamptz not null,
  status            followup_queue_status not null default 'pending',
  scheduled_for     timestamptz not null,
  sent_at           timestamptz,
  message_id        uuid references messages(id) on delete set null,
  error             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_followup_queue_org      on followup_queue(organization_id);
create index idx_followup_queue_conv     on followup_queue(conversation_id);
create index idx_followup_queue_status   on followup_queue(status, scheduled_for);

-- Idempotency: one active row per (conversation, step, cycle).
-- Terminal rows (sent, skipped, failed, cancelled) are unlimited for audit trail.
create unique index uidx_followup_queue_active
  on followup_queue (conversation_id, step_id, cycle_started_at)
  where status in ('pending', 'sending');

-- ─── FOLLOWUP_EVENTS ─────────────────────────────────────────────────────────
-- Full audit trail.

create table if not exists followup_events (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id) on delete cascade,
  queue_item_id   uuid references followup_queue(id) on delete set null,
  conversation_id uuid references conversations(id) on delete set null,
  lead_id         uuid references leads(id) on delete set null,
  event_type      text not null,   -- queued, sent, skipped, cancelled, deferred, failed, cycle_reset
  metadata        jsonb,
  created_at      timestamptz not null default now()
);

create index idx_followup_events_org  on followup_events(organization_id, created_at desc);
create index idx_followup_events_conv on followup_events(conversation_id, created_at desc);

-- ─── ALTER: leads ────────────────────────────────────────────────────────────

alter table leads
  add column if not exists followup_paused boolean not null default false;

-- ─── ALTER: messages ─────────────────────────────────────────────────────────

alter table messages
  add column if not exists is_automatic boolean not null default false;

-- ─── TRIGGERS ────────────────────────────────────────────────────────────────

create trigger trg_followup_settings_updated_at
  before update on followup_settings
  for each row execute function update_updated_at();

create trigger trg_followup_steps_updated_at
  before update on followup_steps
  for each row execute function update_updated_at();

create trigger trg_followup_queue_updated_at
  before update on followup_queue
  for each row execute function update_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────────────

alter table followup_settings        enable row level security;
alter table followup_steps           enable row level security;
alter table followup_business_hours  enable row level security;
alter table followup_blocked_stages  enable row level security;
alter table followup_blocked_tags    enable row level security;
alter table followup_queue           enable row level security;
alter table followup_events          enable row level security;

-- Sync staff (super_admin / gestor_sync) can read/write everything.
-- Org admins can read/write their own org. Atendentes can read.

create policy "followup_settings_sync_staff" on followup_settings
  for all using (is_sync_staff());

create policy "followup_settings_org_admin" on followup_settings
  for all using (
    organization_id in (select * from get_user_org_ids())
    and exists (
      select 1 from organization_members
      where user_id = auth.uid()
        and organization_id = followup_settings.organization_id
        and role in ('admin_clinica')
    )
  );

create policy "followup_settings_org_read" on followup_settings
  for select using (organization_id in (select * from get_user_org_ids()));

create policy "followup_steps_sync_staff" on followup_steps
  for all using (is_sync_staff());

create policy "followup_steps_org_admin" on followup_steps
  for all using (
    organization_id in (select * from get_user_org_ids())
    and exists (
      select 1 from organization_members
      where user_id = auth.uid()
        and organization_id = followup_steps.organization_id
        and role in ('admin_clinica')
    )
  );

create policy "followup_steps_org_read" on followup_steps
  for select using (organization_id in (select * from get_user_org_ids()));

create policy "followup_hours_sync_staff" on followup_business_hours
  for all using (is_sync_staff());

create policy "followup_hours_org_admin" on followup_business_hours
  for all using (
    organization_id in (select * from get_user_org_ids())
    and exists (
      select 1 from organization_members
      where user_id = auth.uid()
        and organization_id = followup_business_hours.organization_id
        and role in ('admin_clinica')
    )
  );

create policy "followup_hours_org_read" on followup_business_hours
  for select using (organization_id in (select * from get_user_org_ids()));

create policy "followup_blocked_stages_sync_staff" on followup_blocked_stages
  for all using (is_sync_staff());

create policy "followup_blocked_stages_org_admin" on followup_blocked_stages
  for all using (
    organization_id in (select * from get_user_org_ids())
    and exists (
      select 1 from organization_members
      where user_id = auth.uid()
        and organization_id = followup_blocked_stages.organization_id
        and role in ('admin_clinica')
    )
  );

create policy "followup_blocked_stages_org_read" on followup_blocked_stages
  for select using (organization_id in (select * from get_user_org_ids()));

create policy "followup_blocked_tags_sync_staff" on followup_blocked_tags
  for all using (is_sync_staff());

create policy "followup_blocked_tags_org_admin" on followup_blocked_tags
  for all using (
    organization_id in (select * from get_user_org_ids())
    and exists (
      select 1 from organization_members
      where user_id = auth.uid()
        and organization_id = followup_blocked_tags.organization_id
        and role in ('admin_clinica')
    )
  );

create policy "followup_blocked_tags_org_read" on followup_blocked_tags
  for select using (organization_id in (select * from get_user_org_ids()));

create policy "followup_queue_sync_staff" on followup_queue
  for all using (is_sync_staff());

create policy "followup_queue_org_read" on followup_queue
  for select using (organization_id in (select * from get_user_org_ids()));

create policy "followup_events_sync_staff" on followup_events
  for all using (is_sync_staff());

create policy "followup_events_org_read" on followup_events
  for select using (organization_id in (select * from get_user_org_ids()));
