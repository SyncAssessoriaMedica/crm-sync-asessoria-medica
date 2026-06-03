-- ============================================================
-- CRM Sync Marketing - Migration 019: Appointment scheduled date
-- ============================================================

alter table leads
  add column if not exists appointment_scheduled_at timestamptz;

create index if not exists idx_leads_appointment_scheduled_at
  on leads(organization_id, appointment_scheduled_at desc)
  where appointment_scheduled_at is not null;
