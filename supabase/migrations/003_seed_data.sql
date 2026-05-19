-- ============================================================
-- CRM Sync Marketing — Migration 003: Dados iniciais de configuração
-- ============================================================
-- Nota: execute após ter criado a organização e usuários via Auth.
-- ============================================================

-- Pipeline padrão para cada organização pode ser criado automaticamente
-- via trigger ao criar uma nova organização:

create or replace function create_default_pipeline()
returns trigger as $$
declare
  pipeline_id uuid;
begin
  -- Criar pipeline padrão
  insert into pipelines (organization_id, name, is_default)
  values (new.id, 'Pipeline Principal', true)
  returning id into pipeline_id;

  -- Criar etapas padrão
  insert into pipeline_stages (pipeline_id, name, "order", color) values
    (pipeline_id, 'Novo',         1, '#8a948d'),
    (pipeline_id, 'Contactado',   2, '#22c55e'),
    (pipeline_id, 'Qualificado',  3, '#16a34a'),
    (pipeline_id, 'Agendado',     4, '#46e27f'),
    (pipeline_id, 'Compareceu',   5, '#0f4f2a'),
    (pipeline_id, 'Fechado',      6, '#22c55e'),
    (pipeline_id, 'Perdido',      7, '#dc2626'),
    (pipeline_id, 'Não Compareceu', 8, '#f59e0b');

  -- Criar origens padrão
  insert into lead_sources (organization_id, name, color) values
    (new.id, 'Meta Ads',          '#1877F2'),
    (new.id, 'Google Ads',        '#4285F4'),
    (new.id, 'WhatsApp Orgânico', '#25D366'),
    (new.id, 'Instagram',         '#E1306C'),
    (new.id, 'Indicação',         '#22c55e'),
    (new.id, 'Site',              '#526058');

  -- Criar tags padrão
  insert into tags (organization_id, name, color) values
    (new.id, 'Quente',         '#22c55e'),
    (new.id, 'Frio',           '#8a948d'),
    (new.id, 'Seguir',         '#f59e0b'),
    (new.id, 'Em Negociação',  '#16a34a'),
    (new.id, 'VIP',            '#0f4f2a'),
    (new.id, 'Preço',          '#dc2626');

  -- Criar conta de billing (trial 30 dias)
  insert into billing_accounts (organization_id, plan, status, trial_ends_at)
  values (new.id, 'trial', 'active', now() + interval '30 days');

  return new;
end;
$$ language plpgsql security definer;

create trigger trg_new_organization_setup
  after insert on organizations
  for each row execute function create_default_pipeline();

-- Trigger para criar profile automaticamente após signup
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Trigger para registrar eventos no timeline de leads
create or replace function log_lead_event()
returns trigger as $$
begin
  if TG_OP = 'INSERT' then
    insert into lead_events (lead_id, event_type, description)
    values (new.id, 'created', 'Lead criado');
  elsif TG_OP = 'UPDATE' then
    if old.status <> new.status then
      insert into lead_events (lead_id, event_type, description, metadata)
      values (
        new.id,
        'status_changed',
        'Status alterado para ' || new.status,
        jsonb_build_object('from', old.status, 'to', new.status)
      );
    end if;
    if old.stage_id is distinct from new.stage_id then
      insert into lead_events (lead_id, event_type, description, metadata)
      values (
        new.id,
        'stage_changed',
        'Etapa do funil atualizada',
        jsonb_build_object('from', old.stage_id, 'to', new.stage_id)
      );
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger trg_lead_events
  after insert or update on leads
  for each row execute function log_lead_event();
