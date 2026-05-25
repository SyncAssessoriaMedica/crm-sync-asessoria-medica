-- ============================================================
-- CRM Sync Marketing - Migration 009
-- Deduplicate leads by organization + phone and enforce uniqueness
-- ============================================================

-- 1. Move dependent records from duplicate leads to the canonical lead.
-- Canonical lead = oldest created_at, then smallest id for each organization+phone.
with duplicate_map as (
  select
    id as duplicate_id,
    first_value(id) over (
      partition by organization_id, phone
      order by created_at asc, id asc
    ) as keep_id
  from leads
  where phone is not null
),
to_merge as (
  select duplicate_id, keep_id
  from duplicate_map
  where duplicate_id <> keep_id
)
insert into lead_tags (lead_id, tag_id)
select distinct tm.keep_id, lt.tag_id
from lead_tags lt
join to_merge tm on tm.duplicate_id = lt.lead_id
on conflict (lead_id, tag_id) do nothing;

with duplicate_map as (
  select
    id as duplicate_id,
    first_value(id) over (
      partition by organization_id, phone
      order by created_at asc, id asc
    ) as keep_id
  from leads
  where phone is not null
),
to_merge as (
  select duplicate_id, keep_id
  from duplicate_map
  where duplicate_id <> keep_id
)
insert into custom_field_values (lead_id, field_id, value)
select distinct on (tm.keep_id, cfv.field_id)
  tm.keep_id,
  cfv.field_id,
  cfv.value
from custom_field_values cfv
join to_merge tm on tm.duplicate_id = cfv.lead_id
order by tm.keep_id, cfv.field_id, cfv.created_at desc
on conflict (lead_id, field_id) do nothing;

with duplicate_map as (
  select
    id as duplicate_id,
    first_value(id) over (
      partition by organization_id, phone
      order by created_at asc, id asc
    ) as keep_id
  from leads
  where phone is not null
),
to_merge as (
  select duplicate_id, keep_id
  from duplicate_map
  where duplicate_id <> keep_id
)
update lead_notes ln
set lead_id = tm.keep_id
from to_merge tm
where ln.lead_id = tm.duplicate_id;

with duplicate_map as (
  select
    id as duplicate_id,
    first_value(id) over (
      partition by organization_id, phone
      order by created_at asc, id asc
    ) as keep_id
  from leads
  where phone is not null
),
to_merge as (
  select duplicate_id, keep_id
  from duplicate_map
  where duplicate_id <> keep_id
)
update lead_events le
set lead_id = tm.keep_id
from to_merge tm
where le.lead_id = tm.duplicate_id;

with duplicate_map as (
  select
    id as duplicate_id,
    first_value(id) over (
      partition by organization_id, phone
      order by created_at asc, id asc
    ) as keep_id
  from leads
  where phone is not null
),
to_merge as (
  select duplicate_id, keep_id
  from duplicate_map
  where duplicate_id <> keep_id
)
update lead_tasks lt
set lead_id = tm.keep_id
from to_merge tm
where lt.lead_id = tm.duplicate_id;

with duplicate_map as (
  select
    id as duplicate_id,
    first_value(id) over (
      partition by organization_id, phone
      order by created_at asc, id asc
    ) as keep_id
  from leads
  where phone is not null
),
to_merge as (
  select duplicate_id, keep_id
  from duplicate_map
  where duplicate_id <> keep_id
)
update conversations c
set lead_id = tm.keep_id
from to_merge tm
where c.lead_id = tm.duplicate_id;

-- 2. Merge useful scalar data into the canonical lead before deleting duplicates.
with duplicate_map as (
  select
    id,
    organization_id,
    phone,
    first_value(id) over (
      partition by organization_id, phone
      order by created_at asc, id asc
    ) as keep_id
  from leads
  where phone is not null
),
rollup as (
  select
    dm.keep_id,
    max(l.last_interaction_at) as last_interaction_at,
    max(l.potential_value) filter (where l.potential_value is not null) as potential_value,
    max(l.closed_value) filter (where l.closed_value is not null) as closed_value,
    string_agg(distinct nullif(l.observations, ''), E'\n\n') filter (where nullif(l.observations, '') is not null) as observations
  from duplicate_map dm
  join leads l on l.id = dm.id
  group by dm.keep_id
)
update leads l
set
  last_interaction_at = coalesce(greatest(l.last_interaction_at, r.last_interaction_at), l.last_interaction_at, r.last_interaction_at),
  potential_value = coalesce(l.potential_value, r.potential_value),
  closed_value = coalesce(l.closed_value, r.closed_value),
  observations = coalesce(l.observations, r.observations)
from rollup r
where l.id = r.keep_id;

-- 3. Delete duplicate leads after all references have been moved.
with duplicate_map as (
  select
    id as duplicate_id,
    first_value(id) over (
      partition by organization_id, phone
      order by created_at asc, id asc
    ) as keep_id
  from leads
  where phone is not null
),
to_delete as (
  select duplicate_id
  from duplicate_map
  where duplicate_id <> keep_id
)
delete from leads l
using to_delete td
where l.id = td.duplicate_id;

-- 4. Enforce the invariant at the database level.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'leads_organization_phone_key'
  ) then
    alter table leads
      add constraint leads_organization_phone_key unique (organization_id, phone);
  end if;
end $$;
