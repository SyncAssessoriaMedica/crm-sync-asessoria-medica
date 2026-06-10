-- Migration 027: organization-scoped quick messages for the WhatsApp inbox.

create table if not exists quick_messages (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id) on delete cascade,
  title           text not null,
  shortcut        text not null,
  message_type    message_type not null default 'text',
  content         text,
  media_url       text,
  media_mimetype  text,
  media_filename  text,
  media_duration  int,
  media_ptt       boolean,
  active          boolean not null default true,
  created_by      uuid references profiles(id) on delete set null,
  updated_by      uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  constraint quick_messages_shortcut_format check (shortcut ~ '^[a-z0-9_-]{2,40}$'),
  constraint quick_messages_content_length check (char_length(coalesce(content, '')) <= 4000),
  constraint quick_messages_payload check (
    (message_type = 'text' and nullif(btrim(content), '') is not null and media_url is null)
    or
    (message_type in ('image', 'audio', 'video', 'document', 'sticker') and media_url is not null)
  )
);

create unique index if not exists idx_quick_messages_org_shortcut_active
  on quick_messages(organization_id, shortcut)
  where deleted_at is null;

create index if not exists idx_quick_messages_org_active_title
  on quick_messages(organization_id, active, title)
  where deleted_at is null;

drop trigger if exists trg_quick_messages_updated_at on quick_messages;
create trigger trg_quick_messages_updated_at
  before update on quick_messages
  for each row execute function update_updated_at();

alter table quick_messages enable row level security;

drop policy if exists "quick_messages_select" on quick_messages;
create policy "quick_messages_select" on quick_messages for select
  using (
    is_sync_staff()
    or (
      organization_id in (select get_user_org_ids())
      and get_user_role_in_org(organization_id) in ('admin_clinica', 'atendente')
    )
  );

drop policy if exists "quick_messages_insert" on quick_messages;
create policy "quick_messages_insert" on quick_messages for insert
  with check (
    is_sync_staff()
    or (
      organization_id in (select get_user_org_ids())
      and get_user_role_in_org(organization_id) in ('admin_clinica', 'atendente')
    )
  );

drop policy if exists "quick_messages_update" on quick_messages;
create policy "quick_messages_update" on quick_messages for update
  using (
    is_sync_staff()
    or (
      organization_id in (select get_user_org_ids())
      and get_user_role_in_org(organization_id) in ('admin_clinica', 'atendente')
    )
  )
  with check (
    is_sync_staff()
    or (
      organization_id in (select get_user_org_ids())
      and get_user_role_in_org(organization_id) in ('admin_clinica', 'atendente')
    )
  );

drop policy if exists "quick_messages_delete" on quick_messages;
create policy "quick_messages_delete" on quick_messages for delete
  using (
    is_sync_staff()
    or (
      organization_id in (select get_user_org_ids())
      and get_user_role_in_org(organization_id) in ('admin_clinica', 'atendente')
    )
  );
