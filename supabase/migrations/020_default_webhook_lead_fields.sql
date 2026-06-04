-- ================================================================
-- CRM Sync Marketing — Migration 020: Default webhook lead fields
-- ================================================================

insert into custom_fields (organization_id, name, key, field_type, required, options, "order")
select o.id, field.name, field.key, 'text', false, null, field.order_index
from organizations o
cross join (
  values
    ('Servico', 'servico', 210),
    ('Campanha', 'campanha', 220),
    ('Conjunto', 'conjunto', 230),
    ('Criativo', 'criativo', 240)
) as field(name, key, order_index)
where not exists (
  select 1
  from custom_fields cf
  where cf.organization_id = o.id
    and cf.key = field.key
);
