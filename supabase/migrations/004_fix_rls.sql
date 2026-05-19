-- ============================================================
-- CRM Sync Marketing — Migration 004: Fix missing RLS policies
-- ============================================================
-- Corrige policies ausentes na migration 002:
--   - pipelines: nenhuma policy de SELECT
--   - pipeline_stages: nenhuma policy de SELECT
--   - lead_tasks: faltava UPDATE (para marcar tarefas como concluídas)
--   - lead_events: faltava INSERT (trigger log_lead_event falha sem ela)
--   - lead_tags: faltava SELECT (para exibir tags nos leads)

-- ─── PIPELINES ───────────────────────────────────────────────────────────────

create policy "pipelines_select" on pipelines for select
  using (
    is_sync_staff()
    or organization_id in (select * from get_user_org_ids())
  );

create policy "pipelines_write" on pipelines for all
  using (
    is_sync_staff()
    or get_user_role_in_org(organization_id) = 'admin_clinica'
  );

-- ─── PIPELINE_STAGES ────────────────────────────────────────────────────────

create policy "stages_select" on pipeline_stages for select
  using (
    is_sync_staff()
    or pipeline_id in (
      select id from pipelines
      where organization_id in (select * from get_user_org_ids())
    )
  );

create policy "stages_write" on pipeline_stages for all
  using (
    is_sync_staff()
    or pipeline_id in (
      select id from pipelines
      where organization_id in (select * from get_user_org_ids())
        and get_user_role_in_org(organization_id) = 'admin_clinica'
    )
  );

-- ─── LEAD_TASKS UPDATE (para marcar tarefas como concluídas) ─────────────────

create policy "tasks_update" on lead_tasks for update
  using (
    is_sync_staff()
    or lead_id in (
      select id from leads
      where organization_id in (select * from get_user_org_ids())
    )
  );

create policy "tasks_delete" on lead_tasks for delete
  using (
    is_sync_staff()
    or lead_id in (
      select id from leads
      where organization_id in (select * from get_user_org_ids())
    )
  );

-- ─── LEAD_EVENTS INSERT (trigger log_lead_event executa no contexto do user) ─
-- Sem esta policy, updates de status/stage do lead são revertidos pelo trigger.

create policy "events_insert" on lead_events for insert
  with check (
    is_sync_staff()
    or lead_id in (
      select id from leads
      where organization_id in (select * from get_user_org_ids())
    )
  );

-- ─── LEAD_TAGS ────────────────────────────────────────────────────────────────

create policy "lead_tags_select" on lead_tags for select
  using (
    is_sync_staff()
    or lead_id in (
      select id from leads
      where organization_id in (select * from get_user_org_ids())
    )
  );

create policy "lead_tags_write" on lead_tags for all
  using (
    is_sync_staff()
    or lead_id in (
      select id from leads l
      where l.organization_id in (select * from get_user_org_ids())
        and get_user_role_in_org(l.organization_id) in ('admin_clinica', 'atendente')
    )
  );
