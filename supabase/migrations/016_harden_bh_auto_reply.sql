-- ============================================================
-- CRM Sync Marketing - Migration 016
-- Harden business-hours auto-reply audit fields
-- ============================================================

alter table bh_auto_reply_queue
  add column if not exists trigger_message_id uuid null references messages(id) on delete set null,
  add column if not exists cancel_reason text null;

create index if not exists idx_bh_auto_reply_trigger_message
  on bh_auto_reply_queue(trigger_message_id)
  where trigger_message_id is not null;
