import type { LeadStatus, MessageDirection, MessageType } from "@/lib/types";

export type InboxLead = {
  id: string;
  name: string;
  phone: string;
  procedure: string | null;
  status: LeadStatus;
  potential_value: number | null;
  followup_paused: boolean;
  source: { name: string | null } | null;
  stage: { name: string | null } | null;
};

export type InboxInstance = {
  id: string;
  instance_name: string;
  phone_number: string | null;
  status: "connected" | "disconnected" | "connecting";
};

export type InboxMessage = {
  id: string;
  conversation_id: string;
  direction: MessageDirection;
  message_type: MessageType;
  content: string | null;
  media_url: string | null;
  media_mimetype: string | null;
  media_filename: string | null;
  media_duration: number | null;
  created_at: string;
  delivered_at: string | null;
  read_at: string | null;
};

export type InboxConversation = {
  id: string;
  remote_jid: string;
  unread_count: number;
  status: "open" | "closed" | "archived";
  created_at: string;
  updated_at: string;
  lead: InboxLead | null;
  instance: InboxInstance | null;
  last_message: InboxMessage | null;
};
