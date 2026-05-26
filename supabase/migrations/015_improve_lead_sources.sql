-- ============================================================
-- CRM Sync Marketing — Migration 015: Improve lead_sources
-- Adds active, is_default, updated_at; unique case-insensitive index.
-- ============================================================

-- 1. Add new columns
alter table lead_sources
  add column if not exists active      boolean     not null default true,
  add column if not exists is_default  boolean     not null default false,
  add column if not exists updated_at  timestamptz not null default now();

-- 2. Mark the six seeded sources as is_default = true for all orgs
update lead_sources
  set is_default = true
  where name in (
    'Meta Ads',
    'Google Ads',
    'WhatsApp Orgânico',
    'Instagram',
    'Indicação',
    'Site'
  );

-- 3. Trigger to keep updated_at current on every update
create or replace function set_lead_sources_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_lead_sources_updated_at on lead_sources;
create trigger trg_lead_sources_updated_at
  before update on lead_sources
  for each row execute function set_lead_sources_updated_at();

-- 4. Unique case-insensitive index (only among active sources per org)
drop index if exists idx_lead_sources_lower_name;
create unique index idx_lead_sources_lower_name
  on lead_sources (organization_id, lower(name))
  where active = true;

-- 5. Update create_default_pipeline to mark new seeds as is_default = true
create or replace function create_default_pipeline()
returns trigger as $$
declare
  pipeline_id uuid;
begin
  insert into pipelines (organization_id, name, is_default)
  values (new.id, 'Pipeline Principal', true)
  returning id into pipeline_id;

  insert into pipeline_stages (pipeline_id, name, "order", color) values
    (pipeline_id, 'Novo',             1, '#8a948d'),
    (pipeline_id, 'Contactado',       2, '#22c55e'),
    (pipeline_id, 'Qualificado',      3, '#16a34a'),
    (pipeline_id, 'Agendado',         4, '#46e27f'),
    (pipeline_id, 'Compareceu',       5, '#0f4f2a'),
    (pipeline_id, 'Fechado',          6, '#22c55e'),
    (pipeline_id, 'Perdido',          7, '#dc2626'),
    (pipeline_id, 'Não Compareceu',   8, '#f59e0b');

  insert into lead_sources (organization_id, name, color, is_default) values
    (new.id, 'Meta Ads',          '#1877F2', true),
    (new.id, 'Google Ads',        '#4285F4', true),
    (new.id, 'WhatsApp Orgânico', '#25D366', true),
    (new.id, 'Instagram',         '#E1306C', true),
    (new.id, 'Indicação',         '#22c55e', true),
    (new.id, 'Site',              '#526058', true);

  insert into tags (organization_id, name, color) values
    (new.id, 'Quente',        '#22c55e'),
    (new.id, 'Frio',          '#8a948d'),
    (new.id, 'Seguir',        '#f59e0b'),
    (new.id, 'Em Negociação', '#16a34a'),
    (new.id, 'VIP',           '#0f4f2a'),
    (new.id, 'Preço',         '#dc2626');

  insert into billing_accounts (organization_id, plan, status, trial_ends_at)
  values (new.id, 'trial', 'active', now() + interval '30 days');

  return new;
end;
$$ language plpgsql security definer;
