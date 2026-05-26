-- ============================================================
-- CRM Sync Marketing - Migration 013
-- Soft delete for WhatsApp instances + automatic lead source rules
-- ============================================================

-- Preserve conversation/message history when an instance is removed.
-- deleted_at IS NOT NULL means the instance must be hidden from the UI and ignored by webhooks.
alter table whatsapp_instances
  add column if not exists deleted_at    timestamptz null,
  add column if not exists deleted_by    uuid        null references profiles(id) on delete set null,
  add column if not exists delete_reason text        null;

create index if not exists idx_wa_instances_active
  on whatsapp_instances(organization_id, created_at desc)
  where deleted_at is null;

-- Rules that map the first inbound WhatsApp message to a lead source.
create table if not exists lead_source_rules (
  id                   uuid    primary key default uuid_generate_v4(),
  organization_id      uuid    not null references organizations(id) on delete cascade,
  source_id            uuid    not null references lead_sources(id) on delete cascade,
  name                 text    not null,
  match_type           text    not null check (match_type in ('exact','contains','starts_with','regex')),
  pattern              text    not null,
  case_sensitive       boolean not null default false,
  normalize_whitespace boolean not null default true,
  overwrite_existing   boolean not null default false,
  active               boolean not null default true,
  priority             integer not null default 100,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_source_rules_org_active
  on lead_source_rules(organization_id, priority asc, created_at asc)
  where active = true;

alter table lead_source_rules enable row level security;

drop policy if exists "source_rules_select" on lead_source_rules;
drop policy if exists "source_rules_insert" on lead_source_rules;
drop policy if exists "source_rules_update" on lead_source_rules;
drop policy if exists "source_rules_delete" on lead_source_rules;

create policy "source_rules_select" on lead_source_rules for select
  using (
    is_sync_staff()
    or organization_id in (select * from get_user_org_ids())
  );

create policy "source_rules_insert" on lead_source_rules for insert
  with check (
    is_sync_staff()
    or (
      organization_id in (select * from get_user_org_ids())
      and get_user_role_in_org(organization_id) = 'admin_clinica'
    )
  );

create policy "source_rules_update" on lead_source_rules for update
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

create policy "source_rules_delete" on lead_source_rules for delete
  using (
    is_sync_staff()
    or (
      organization_id in (select * from get_user_org_ids())
      and get_user_role_in_org(organization_id) = 'admin_clinica'
    )
  );

drop trigger if exists trg_source_rules_updated_at on lead_source_rules;
create trigger trg_source_rules_updated_at
  before update on lead_source_rules
  for each row execute function update_updated_at();
