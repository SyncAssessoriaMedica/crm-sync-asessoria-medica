-- Migration 023: lightweight latest-message lookup for Inbox lists
-- Keeps the conversation list fast while full message history loads only for the active chat.

create or replace function public.get_latest_inbox_messages(conversation_ids uuid[])
returns table (
  id uuid,
  conversation_id uuid,
  direction message_direction,
  message_type message_type,
  content text,
  media_url text,
  media_mimetype text,
  media_filename text,
  media_duration int,
  created_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz
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
    m.read_at
  from public.messages m
  where m.conversation_id = any(conversation_ids)
  order by m.conversation_id, m.created_at desc;
$$;
