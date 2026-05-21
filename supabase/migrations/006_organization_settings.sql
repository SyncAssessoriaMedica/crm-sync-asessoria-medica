-- Migration 006: organization-level settings for the Settings page

create table if not exists organization_settings (
  organization_id uuid primary key references organizations(id) on delete cascade,
  cnpj text,
  city text,
  state text,
  scheduling_url text,
  notification_preferences jsonb not null default '{
    "new_lead": true,
    "lead_without_response": true,
    "lead_without_followup": false,
    "appointment_confirmed": true
  }'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table organization_settings enable row level security;

drop policy if exists "settings_select_org_members" on organization_settings;
create policy "settings_select_org_members"
  on organization_settings for select
  using (is_sync_staff() or organization_id in (select get_user_org_ids()));

drop policy if exists "settings_update_admins" on organization_settings;
create policy "settings_update_admins"
  on organization_settings for all
  using (is_sync_staff() or get_user_role_in_org(organization_id) = 'admin_clinica')
  with check (is_sync_staff() or get_user_role_in_org(organization_id) = 'admin_clinica');

drop trigger if exists trg_organization_settings_updated_at on organization_settings;
create trigger trg_organization_settings_updated_at
  before update on organization_settings
  for each row execute function update_updated_at();
