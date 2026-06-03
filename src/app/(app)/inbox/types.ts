import type { LeadStatus, MessageDirection, MessageType } from "@/lib/types";

export type InboxLead = {
  id: string;
  name: string;
  phone: string;
  procedure: string | null;
  status: LeadStatus;
  potential_value: number | null;
  appointment_scheduled_at: string | null;
  followup_paused: boolean;
  source_id: string | null;
  phone_ddd: string | null;
  detected_state: string | null;
  detected_city: string | null;
  service_area_status: "inside" | "possible" | "outside" | "unknown";
  source: { id?: string | null; name: string | null; active?: boolean | null } | null;
  stage: { name: string | null } | null;
};

export type InboxSource = {
  id: string;
  name: string;
  color: string | null;
  active: boolean;
};

export type InboxInstance = {
  id: string;
  instance_name: string;
  phone_number: string | null;
  status: "connected" | "disconnected" | "connecting";
  deleted_at?: string | null;
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

export type BhAutoReplyQueueItem = {
  id: string;
  conversation_id: string;
  scheduled_for: string;
  status: "pending" | "sending";
};
