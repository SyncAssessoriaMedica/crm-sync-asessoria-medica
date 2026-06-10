-- Migration 028: add the Retorno and Mais de 2 follow-ups default stages.
-- Existing leads are not moved. The exhausted follow-up stage is blocked from automation.

insert into pipeline_stages (pipeline_id, name, "order", color)
select p.id, 'Retorno', 9, '#94a3b8'
from pipelines p
where p.is_default = true
  and not exists (
    select 1 from pipeline_stages s
    where s.pipeline_id = p.id and lower(s.name) = lower('Retorno')
  );

insert into pipeline_stages (pipeline_id, name, "order", color)
select p.id, 'Mais de 2 follow-ups', 10, '#64748b'
from pipelines p
where p.is_default = true
  and not exists (
    select 1 from pipeline_stages s
    where s.pipeline_id = p.id and lower(s.name) = lower('Mais de 2 follow-ups')
  );

insert into followup_blocked_stages (organization_id, stage_id)
select p.organization_id, s.id
from pipelines p
join pipeline_stages s on s.pipeline_id = p.id
where p.is_default = true
  and lower(s.name) = lower('Mais de 2 follow-ups')
on conflict (organization_id, stage_id) do nothing;

create or replace function create_default_pipeline()
returns trigger as $$
declare
  v_pipeline_id uuid;
  exhausted_stage_id uuid;
begin
  insert into pipelines (organization_id, name, is_default)
  values (new.id, 'Pipeline Principal', true)
  returning id into v_pipeline_id;

  insert into pipeline_stages (pipeline_id, name, "order", color) values
    (v_pipeline_id, 'Novo',               1,  '#8a948d'),
    (v_pipeline_id, 'Contactado',         2,  '#22c55e'),
    (v_pipeline_id, 'Qualificado',        3,  '#16a34a'),
    (v_pipeline_id, 'Agendado',           4,  '#46e27f'),
    (v_pipeline_id, 'Compareceu',         5,  '#0f4f2a'),
    (v_pipeline_id, 'Fechado',            6,  '#22c55e'),
    (v_pipeline_id, 'Perdido',            7,  '#dc2626'),
    (v_pipeline_id, 'Não Compareceu',     8,  '#f59e0b'),
    (v_pipeline_id, 'Retorno',            9,  '#94a3b8'),
    (v_pipeline_id, 'Mais de 2 follow-ups', 10, '#64748b');

  select id into exhausted_stage_id
  from pipeline_stages
  where pipeline_id = v_pipeline_id
    and name = 'Mais de 2 follow-ups'
  limit 1;

  insert into followup_blocked_stages (organization_id, stage_id)
  values (new.id, exhausted_stage_id)
  on conflict (organization_id, stage_id) do nothing;

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
