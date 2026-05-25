-- ============================================================
-- CRM Sync Marketing — Migration 008: Security hardening
-- ============================================================
-- Idempotent: safe to run multiple times (CREATE OR REPLACE / DROP IF EXISTS).
--
-- Changes:
--   1. Add `set search_path = public, pg_temp` to all SECURITY DEFINER
--      functions to prevent search-path injection attacks.
--   2. Add WITH CHECK clauses to "for all" policies that previously had
--      only a USING clause, preventing cross-org row insertion/update.
-- ============================================================

-- ─── 1. SECURITY DEFINER functions — pin the search path ─────────────────────
-- Without set search_path, an unprivileged user can create a temporary schema
-- object that shadows public tables and hijack the function execution.

create or replace function get_user_org_ids()
returns setof uuid
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select organization_id
  from organization_members
  where user_id = auth.uid()
$$;

create or replace function is_sync_staff()
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1
    from organization_members
    where user_id = auth.uid()
      and role in ('super_admin', 'gestor_sync')
  )
$$;

create or replace function get_user_role_in_org(org_id uuid)
returns user_role
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select role
  from organization_members
  where user_id = auth.uid()
    and organization_id = org_id
  limit 1
$$;

-- ─── 2. Policies: add WITH CHECK where missing ────────────────────────────────
-- "FOR ALL USING (...)" without "WITH CHECK" is a PostgreSQL quirk:
-- the USING expression gates SELECT/UPDATE/DELETE but INSERT is gated by
-- WITH CHECK — if omitted it defaults to the USING expression, which is
-- correct in most cases BUT is easy to miss and silently changes behaviour
-- when the USING expression references the OLD row vs. the NEW row.
-- Making WITH CHECK explicit removes ambiguity and satisfies security audits.

-- lead_sources
drop policy if exists "sources_write" on lead_sources;
create policy "sources_write" on lead_sources for all
  using   (is_sync_staff() or get_user_role_in_org(organization_id) = 'admin_clinica')
  with check (is_sync_staff() or get_user_role_in_org(organization_id) = 'admin_clinica');

-- campaigns
drop policy if exists "campaigns_write" on campaigns;
create policy "campaigns_write" on campaigns for all
  using   (is_sync_staff() or get_user_role_in_org(organization_id) = 'admin_clinica')
  with check (is_sync_staff() or get_user_role_in_org(organization_id) = 'admin_clinica');

-- tags
drop policy if exists "tags_write" on tags;
create policy "tags_write" on tags for all
  using   (is_sync_staff() or get_user_role_in_org(organization_id) in ('admin_clinica', 'atendente'))
  with check (is_sync_staff() or get_user_role_in_org(organization_id) in ('admin_clinica', 'atendente'));

-- custom_fields
drop policy if exists "custom_fields_write" on custom_fields;
create policy "custom_fields_write" on custom_fields for all
  using   (is_sync_staff() or get_user_role_in_org(organization_id) = 'admin_clinica')
  with check (is_sync_staff() or get_user_role_in_org(organization_id) = 'admin_clinica');

-- pipelines (created in migration 004)
drop policy if exists "pipelines_write" on pipelines;
create policy "pipelines_write" on pipelines for all
  using   (is_sync_staff() or get_user_role_in_org(organization_id) = 'admin_clinica')
  with check (is_sync_staff() or get_user_role_in_org(organization_id) = 'admin_clinica');

-- pipeline_stages (created in migration 004)
drop policy if exists "stages_write" on pipeline_stages;
create policy "stages_write" on pipeline_stages for all
  using (
    is_sync_staff()
    or pipeline_id in (
      select id from pipelines
      where organization_id in (select get_user_org_ids())
        and get_user_role_in_org(organization_id) = 'admin_clinica'
    )
  )
  with check (
    is_sync_staff()
    or pipeline_id in (
      select id from pipelines
      where organization_id in (select get_user_org_ids())
        and get_user_role_in_org(organization_id) = 'admin_clinica'
    )
  );

-- lead_tags (created in migration 004)
drop policy if exists "lead_tags_write" on lead_tags;
create policy "lead_tags_write" on lead_tags for all
  using (
    is_sync_staff()
    or lead_id in (
      select id from leads l
      where l.organization_id in (select get_user_org_ids())
        and get_user_role_in_org(l.organization_id) in ('admin_clinica', 'atendente')
    )
  )
  with check (
    is_sync_staff()
    or lead_id in (
      select id from leads l
      where l.organization_id in (select get_user_org_ids())
        and get_user_role_in_org(l.organization_id) in ('admin_clinica', 'atendente')
    )
  );

-- ─── 3. Audit log: grant service_role INSERT so webhook and server actions ─────
--    can write audit records via createAdminClient (service_role key).
--    The table already has RLS enabled; the service_role bypasses RLS by
--    default in Supabase, so no explicit policy is needed for that path.
--    This comment documents the intent for future reviewers.

-- No-op: service_role already bypasses RLS.
-- Clinic users have SELECT-only via existing "audit_select" policy.
