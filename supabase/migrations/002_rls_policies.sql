-- ============================================================
-- CRM Sync Marketing — Migration 002: Row Level Security (RLS)
-- ============================================================
--
-- Estratégia de isolamento multi-tenant:
-- - Cada usuário pertence a uma ou mais organizations via organization_members.
-- - Supabase Auth fornece auth.uid() como identificador do usuário logado.
-- - Uma função helper get_user_org_ids() retorna os IDs das orgs do usuário.
-- - Super admins (role = 'super_admin') têm acesso a tudo.
-- ============================================================

-- Helper: retorna IDs das organizações do usuário logado
create or replace function get_user_org_ids()
returns setof uuid
language sql
security definer
stable
as $$
  select organization_id
  from organization_members
  where user_id = auth.uid()
$$;

-- Helper: verifica se o usuário é super_admin ou gestor_sync (acesso global)
create or replace function is_sync_staff()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1
    from organization_members
    where user_id = auth.uid()
      and role in ('super_admin', 'gestor_sync')
  )
$$;

-- Helper: verifica o papel do usuário em uma organização específica
create or replace function get_user_role_in_org(org_id uuid)
returns user_role
language sql
security definer
stable
as $$
  select role
  from organization_members
  where user_id = auth.uid()
    and organization_id = org_id
  limit 1
$$;

-- ─── Enable RLS em todas as tabelas ─────────────────────────────────────────

alter table organizations         enable row level security;
alter table profiles               enable row level security;
alter table organization_members   enable row level security;
alter table lead_sources           enable row level security;
alter table campaigns              enable row level security;
alter table pipelines              enable row level security;
alter table pipeline_stages        enable row level security;
alter table tags                   enable row level security;
alter table leads                  enable row level security;
alter table lead_tags              enable row level security;
alter table lead_notes             enable row level security;
alter table lead_events            enable row level security;
alter table lead_tasks             enable row level security;
alter table custom_fields          enable row level security;
alter table custom_field_values    enable row level security;
alter table whatsapp_instances     enable row level security;
alter table conversations          enable row level security;
alter table messages               enable row level security;
alter table billing_accounts       enable row level security;
alter table audit_logs             enable row level security;
alter table webhook_events         enable row level security;

-- ─── ORGANIZATIONS ───────────────────────────────────────────────────────────

-- Sync staff vê todas; usuários vêem apenas as suas
create policy "org_select" on organizations for select
  using (
    is_sync_staff()
    or id in (select * from get_user_org_ids())
  );

-- Apenas super_admin pode criar/alterar orgs
create policy "org_insert" on organizations for insert
  with check (is_sync_staff());

create policy "org_update" on organizations for update
  using (is_sync_staff());

-- ─── PROFILES ────────────────────────────────────────────────────────────────

-- Usuário vê próprio perfil + perfis da sua organização
create policy "profiles_select" on profiles for select
  using (
    id = auth.uid()
    or is_sync_staff()
    or id in (
      select user_id from organization_members
      where organization_id in (select * from get_user_org_ids())
    )
  );

create policy "profiles_update_own" on profiles for update
  using (id = auth.uid());

-- ─── ORGANIZATION MEMBERS ────────────────────────────────────────────────────

create policy "members_select" on organization_members for select
  using (
    is_sync_staff()
    or organization_id in (select * from get_user_org_ids())
  );

-- Apenas admin_clinica+ pode adicionar membros à sua org
create policy "members_insert" on organization_members for insert
  with check (
    is_sync_staff()
    or get_user_role_in_org(organization_id) in ('admin_clinica')
  );

-- ─── LEADS ───────────────────────────────────────────────────────────────────

-- Leitura: qualquer membro da organização
create policy "leads_select" on leads for select
  using (
    is_sync_staff()
    or organization_id in (select * from get_user_org_ids())
  );

-- Escrita: atendente, admin_clinica ou staff
create policy "leads_insert" on leads for insert
  with check (
    is_sync_staff()
    or get_user_role_in_org(organization_id) in ('admin_clinica', 'atendente')
  );

create policy "leads_update" on leads for update
  using (
    is_sync_staff()
    or get_user_role_in_org(organization_id) in ('admin_clinica', 'atendente')
  );

-- Exclusão: apenas admin+
create policy "leads_delete" on leads for delete
  using (
    is_sync_staff()
    or get_user_role_in_org(organization_id) = 'admin_clinica'
  );

-- ─── LEAD_NOTES / EVENTS / TASKS ────────────────────────────────────────────

-- Notas: leitura pela org, escrita por atendente+
create policy "notes_select" on lead_notes for select
  using (
    is_sync_staff()
    or lead_id in (
      select id from leads
      where organization_id in (select * from get_user_org_ids())
    )
  );

create policy "notes_insert" on lead_notes for insert
  with check (
    is_sync_staff()
    or lead_id in (
      select id from leads l
      where l.organization_id in (select * from get_user_org_ids())
        and get_user_role_in_org(l.organization_id) in ('admin_clinica', 'atendente')
    )
  );

-- Events: apenas leitura (escritos por triggers/server)
create policy "events_select" on lead_events for select
  using (
    is_sync_staff()
    or lead_id in (
      select id from leads
      where organization_id in (select * from get_user_org_ids())
    )
  );

-- Tasks: leitura org, escrita atendente+
create policy "tasks_select" on lead_tasks for select
  using (
    is_sync_staff()
    or lead_id in (
      select id from leads
      where organization_id in (select * from get_user_org_ids())
    )
  );

create policy "tasks_insert" on lead_tasks for insert
  with check (
    is_sync_staff()
    or lead_id in (
      select id from leads l
      where l.organization_id in (select * from get_user_org_ids())
    )
  );

-- ─── CONVERSATIONS & MESSAGES ────────────────────────────────────────────────

create policy "conversations_select" on conversations for select
  using (
    is_sync_staff()
    or organization_id in (select * from get_user_org_ids())
  );

create policy "messages_select" on messages for select
  using (
    is_sync_staff()
    or conversation_id in (
      select id from conversations
      where organization_id in (select * from get_user_org_ids())
    )
  );

-- ─── WHATSAPP INSTANCES ──────────────────────────────────────────────────────

create policy "wa_instances_select" on whatsapp_instances for select
  using (
    is_sync_staff()
    or organization_id in (select * from get_user_org_ids())
  );

-- ─── CONFIG TABLES (sources, campaigns, pipelines, etc.) ─────────────────────

-- Padrão: leitura por membro, escrita por admin+
create policy "sources_select" on lead_sources for select
  using (organization_id in (select * from get_user_org_ids()) or is_sync_staff());
create policy "sources_write" on lead_sources for all
  using (is_sync_staff() or get_user_role_in_org(organization_id) = 'admin_clinica');

create policy "campaigns_select" on campaigns for select
  using (organization_id in (select * from get_user_org_ids()) or is_sync_staff());
create policy "campaigns_write" on campaigns for all
  using (is_sync_staff() or get_user_role_in_org(organization_id) = 'admin_clinica');

create policy "tags_select" on tags for select
  using (organization_id in (select * from get_user_org_ids()) or is_sync_staff());
create policy "tags_write" on tags for all
  using (is_sync_staff() or get_user_role_in_org(organization_id) in ('admin_clinica','atendente'));

create policy "custom_fields_select" on custom_fields for select
  using (organization_id in (select * from get_user_org_ids()) or is_sync_staff());
create policy "custom_fields_write" on custom_fields for all
  using (is_sync_staff() or get_user_role_in_org(organization_id) = 'admin_clinica');

-- ─── AUDIT LOGS ──────────────────────────────────────────────────────────────

-- Apenas leitura para admins; sistema escreve via service_role
create policy "audit_select" on audit_logs for select
  using (
    is_sync_staff()
    or (
      organization_id in (select * from get_user_org_ids())
      and get_user_role_in_org(organization_id) = 'admin_clinica'
    )
  );

-- ─── BILLING ─────────────────────────────────────────────────────────────────

create policy "billing_select" on billing_accounts for select
  using (
    is_sync_staff()
    or (
      organization_id in (select * from get_user_org_ids())
      and get_user_role_in_org(organization_id) = 'admin_clinica'
    )
  );

-- ─── WEBHOOK EVENTS ──────────────────────────────────────────────────────────

-- Apenas sync staff acessa logs de webhook
create policy "webhook_events_select" on webhook_events for select
  using (is_sync_staff());
