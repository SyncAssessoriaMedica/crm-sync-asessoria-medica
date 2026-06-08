-- Migration 024: inbox outbound message send-status tracking
-- Adds columns to track send lifecycle for CRM-initiated messages.
-- Inbound/existing messages keep the default 'sent' — no data loss.

alter table messages
  add column if not exists send_status text not null default 'sent'
    check (send_status in ('pending', 'sending', 'sent', 'failed')),
  add column if not exists send_error text null,
  add column if not exists client_message_id uuid null;

-- Unique index: prevents duplicate inserts from a double-click / retry race.
create unique index if not exists idx_messages_client_message_id
  on messages(client_message_id)
  where client_message_id is not null;

-- Composite index: conversation message list ordered by time (replaces seq-scan).
create index if not exists idx_messages_conversation_created
  on messages(conversation_id, created_at);

-- Re-create the latest-message RPC to include the new columns so the
-- conversation list sidebar can show pending/failed status correctly.
-- PostgreSQL cannot change OUT parameters with CREATE OR REPLACE alone.
drop function if exists public.get_latest_inbox_messages(uuid[]);

create or replace function public.get_latest_inbox_messages(conversation_ids uuid[])
returns table (
  id                uuid,
  conversation_id   uuid,
  direction         message_direction,
  message_type      message_type,
  content           text,
  media_url         text,
  media_mimetype    text,
  media_filename    text,
  media_duration    int,
  created_at        timestamptz,
  delivered_at      timestamptz,
  read_at           timestamptz,
  send_status       text,
  send_error        text,
  client_message_id uuid
)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct on (m.conversation_id)
    m.id,
    m.conversation_id,
    m.direction,
    m.message_type,
    m.content,
    m.media_url,
    m.media_mimetype,
    m.media_filename,
    m.media_duration,
    m.created_at,
    m.delivered_at,
    m.read_at,
    m.send_status,
    m.send_error,
    m.client_message_id
  from public.messages m
  where m.conversation_id = any(conversation_ids)
  order by m.conversation_id, m.created_at desc;
$$;
