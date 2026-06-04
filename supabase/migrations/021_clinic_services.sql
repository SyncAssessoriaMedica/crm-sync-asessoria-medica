-- CRM Sync Marketing - Migration 021: Clinic services
-- First-class service catalog per organization and lead service assignment.

create table if not exists clinic_services (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  "order" integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_clinic_services_org_lower_name
  on clinic_services (organization_id, lower(name));

create index if not exists idx_clinic_services_org_active
  on clinic_services (organization_id, active, "order", name);

alter table leads
  add column if not exists service_id uuid references clinic_services(id) on delete set null;

create index if not exists idx_leads_org_service
  on leads (organization_id, service_id);

drop trigger if exists trg_clinic_services_updated_at on clinic_services;
create trigger trg_clinic_services_updated_at
  before update on clinic_services
  for each row execute function update_updated_at();

alter table clinic_services enable row level security;

drop policy if exists "clinic_services_select" on clinic_services;
create policy "clinic_services_select" on clinic_services for select
  using (is_sync_staff() or organization_id in (select * from get_user_org_ids()));

drop policy if exists "clinic_services_write" on clinic_services;
create policy "clinic_services_write" on clinic_services for all
  using (
    is_sync_staff()
    or exists (
      select 1
      from organization_members om
      where om.organization_id = clinic_services.organization_id
        and om.user_id = auth.uid()
        and om.role in ('super_admin', 'gestor_sync', 'admin_clinica')
    )
  )
  with check (
    is_sync_staff()
    or exists (
      select 1
      from organization_members om
      where om.organization_id = clinic_services.organization_id
        and om.user_id = auth.uid()
        and om.role in ('super_admin', 'gestor_sync', 'admin_clinica')
    )
  );
