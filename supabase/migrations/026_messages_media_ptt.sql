-- Migration 026: preserve whether an audio message is a WhatsApp voice note.

alter table messages
  add column if not exists media_ptt boolean null;

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
  media_ptt         boolean,
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
    m.media_ptt,
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
