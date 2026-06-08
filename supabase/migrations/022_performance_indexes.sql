-- Migration 022: Performance indexes for server-side paginated queries
-- Complements indexes from 001_initial_schema.sql
-- All created with IF NOT EXISTS to be safe against re-runs

-- ── Leads: updated_at sorting (Kanban uses updated_at DESC per column) ──────
create index if not exists idx_leads_updated
  on leads(organization_id, updated_at desc);

-- ── Leads: per-column Kanban queries (org + stage + updated_at) ─────────────
create index if not exists idx_leads_stage_updated
  on leads(organization_id, stage_id, updated_at desc);

-- ── Leads: server-side filter indexes ────────────────────────────────────────
create index if not exists idx_leads_source_created
  on leads(organization_id, source_id, created_at desc);

create index if not exists idx_leads_service_created
  on leads(organization_id, service_id, created_at desc);

create index if not exists idx_leads_state_created
  on leads(organization_id, detected_state, created_at desc);

create index if not exists idx_leads_city_created
  on leads(organization_id, detected_city, created_at desc);

create index if not exists idx_leads_area_created
  on leads(organization_id, service_area_status, created_at desc);

-- ── Conversations: org + lead_id lookup (per-page inbox queries) ─────────────
create index if not exists idx_conversations_org_lead
  on conversations(organization_id, lead_id)
  where lead_id is not null;

-- ── Trigram indexes for ILIKE text search on leads name and phone ─────────────
-- Requires pg_trgm extension (enabled in migration 001)
create index if not exists idx_leads_name_trgm
  on leads using gin(name gin_trgm_ops);

create index if not exists idx_leads_phone_trgm
  on leads using gin(phone gin_trgm_ops);
