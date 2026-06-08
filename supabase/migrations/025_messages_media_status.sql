-- Migration 025: inbound WhatsApp media status tracking
-- Adds columns to track async media download lifecycle (pending → ready / failed).
-- Also stores a sanitised copy of the original Evolution webhook payload needed
-- for retry (key / message / messageType, thumbnails stripped).

alter table messages
  add column if not exists media_status   text    null
    check (media_status in ('pending', 'ready', 'failed')),
  add column if not exists media_error    text    null,
  add column if not exists media_attempts int     not null default 0,
  add column if not exists media_payload  jsonb   null;

-- Index for efficiently querying stuck/pending media jobs.
create index if not exists idx_messages_media_status_created
  on messages(media_status, created_at)
  where media_status in ('pending', 'failed');

-- Backfill: existing messages that were successfully stored in Supabase Storage
-- are already "ready" — no further processing needed.
update messages
  set media_status = 'ready'
  where media_url like 'supabase://media/%'
  and   message_type in ('image', 'audio', 'video', 'document', 'sticker')
  and   media_status is null;

-- Re-create the latest-message RPC to expose the new columns.
-- PostgreSQL cannot add OUT parameters with CREATE OR REPLACE; drop first.
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
  client_message_id uuid,
  media_status      text,
  media_error       text,
  media_attempts    int
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
    m.client_message_id,
    m.media_status,
    m.media_error,
    m.media_attempts
  from public.messages m
  where m.conversation_id = any(conversation_ids)
  order by m.conversation_id, m.created_at desc;
$$;
