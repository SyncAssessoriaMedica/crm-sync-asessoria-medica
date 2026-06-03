-- Migration 018: lead location enrichment and clinic service area

alter table organization_settings
  add column if not exists service_area jsonb;

alter table leads
  add column if not exists phone_country text,
  add column if not exists phone_ddd text,
  add column if not exists detected_state text,
  add column if not exists detected_region text,
  add column if not exists detected_city text,
  add column if not exists location_confidence text not null default 'unknown',
  add column if not exists service_area_status text not null default 'unknown',
  add column if not exists location_manually_edited boolean not null default false,
  add column if not exists location_updated_at timestamptz;

create index if not exists idx_leads_location_state
  on leads(organization_id, detected_state);

create index if not exists idx_leads_location_city
  on leads(organization_id, detected_city);

create index if not exists idx_leads_location_ddd
  on leads(organization_id, phone_ddd);

create index if not exists idx_leads_service_area_status
  on leads(organization_id, service_area_status);
