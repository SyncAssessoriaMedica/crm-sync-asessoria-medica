// ─── Organization / Tenant ───────────────────────────────────────────────────

export type SubscriptionStatus = "trial" | "active" | "suspended" | "cancelled";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logo_url?: string;
  subscription_status: SubscriptionStatus;
  subscription_expires_at?: string;
  created_at: string;
  updated_at: string;
}

// ─── Users / Members ─────────────────────────────────────────────────────────

export type UserRole =
  | "super_admin"
  | "gestor_sync"
  | "admin_clinica"
  | "atendente"
  | "leitura";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  avatar_url?: string;
  role: UserRole;
  created_at: string;
}

export interface OrganizationMember {
  id: string;
  organization_id: string;
  user_id: string;
  role: UserRole;
  profile: Profile;
  created_at: string;
}

// ─── Leads ───────────────────────────────────────────────────────────────────

export type LeadStatus =
  | "new"
  | "contacted"
  | "qualified"
  | "scheduled"
  | "attended"
  | "closed_won"
  | "closed_lost"
  | "no_show";

export interface LeadSource {
  id: string;
  organization_id: string;
  name: string;
  color?: string;
  active?: boolean;
  is_default?: boolean;
}

export interface Campaign {
  id: string;
  organization_id: string;
  name: string;
  platform?: string;
  active: boolean;
}

export interface Tag {
  id: string;
  organization_id: string;
  name: string;
  color: string;
}

export interface PipelineStage {
  id: string;
  pipeline_id: string;
  name: string;
  order: number;
  color?: string;
}

export interface Lead {
  id: string;
  organization_id: string;
  name: string;
  phone: string;
  email?: string;
  source_id?: string;
  source?: LeadSource;
  campaign_id?: string;
  campaign?: Campaign;
  procedure?: string;
  stage_id?: string;
  stage?: PipelineStage;
  assignee_id?: string;
  assignee?: Profile;
  status: LeadStatus;
  tags?: Tag[];
  potential_value?: number;
  closed_value?: number;
  created_at: string;
  updated_at: string;
  last_interaction_at?: string;
  next_action_at?: string;
  next_action_note?: string;
  observations?: string;
  phone_country?: string;
  phone_ddd?: string;
  detected_state?: string;
  detected_region?: string;
  detected_city?: string;
  location_confidence?: "high" | "medium" | "low" | "unknown";
  service_area_status?: "inside" | "possible" | "outside" | "unknown";
  location_manually_edited?: boolean;
  location_updated_at?: string;
}

export interface LeadNote {
  id: string;
  lead_id: string;
  author_id: string;
  author?: Profile;
  content: string;
  created_at: string;
}

export interface LeadEvent {
  id: string;
  lead_id: string;
  actor_id?: string;
  actor?: Profile;
  event_type: string;
  description: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface LeadTask {
  id: string;
  lead_id: string;
  assignee_id?: string;
  assignee?: Profile;
  title: string;
  due_at?: string;
  completed_at?: string;
  created_at: string;
}

// ─── WhatsApp / Conversations ────────────────────────────────────────────────

export type MessageType =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "sticker"
  | "location";

export type MessageDirection = "inbound" | "outbound";

export interface WhatsAppInstance {
  id: string;
  organization_id: string;
  instance_name: string;
  phone_number: string;
  status: "connected" | "disconnected" | "connecting";
  deleted_at?: string | null;
  deleted_by?: string | null;
  created_at: string;
}

export type SourceRuleMatchType = "exact" | "contains" | "starts_with" | "regex";

export interface LeadSourceRule {
  id: string;
  organization_id: string;
  source_id: string;
  source?: LeadSource;
  name: string;
  match_type: SourceRuleMatchType;
  pattern: string;
  case_sensitive: boolean;
  normalize_whitespace: boolean;
  overwrite_existing: boolean;
  active: boolean;
  priority: number;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  organization_id: string;
  lead_id?: string;
  lead?: Lead;
  instance_id: string;
  instance?: WhatsAppInstance;
  remote_jid: string;
  last_message?: Message;
  unread_count: number;
  assignee_id?: string;
  assignee?: Profile;
  status: "open" | "closed" | "archived";
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  direction: MessageDirection;
  message_type: MessageType;
  content?: string;
  media_url?: string;
  media_mimetype?: string;
  media_filename?: string;
  media_duration?: number;
  sent_by_id?: string;
  sent_by?: Profile;
  created_at: string;
  delivered_at?: string;
  read_at?: string;
}

// ─── Dashboard / Metrics ─────────────────────────────────────────────────────

export interface DashboardMetrics {
  total_leads: number;
  new_leads: number;
  new_leads_variation: number;
  scheduling_rate: number;
  scheduling_rate_variation: number;
  attendance_rate: number;
  attendance_rate_variation: number;
  closing_rate: number;
  closing_rate_variation: number;
  avg_first_response_minutes: number;
  leads_without_response: number;
  leads_without_followup: number;
  avg_ticket: number;
  estimated_revenue: number;
  estimated_revenue_variation: number;
}

export interface LeadsBySource {
  source: string;
  count: number;
  percentage: number;
}

export interface LeadsByStatus {
  status: LeadStatus;
  label: string;
  count: number;
  color: string;
}

export interface ConversionFunnelItem {
  stage: string;
  count: number;
  rate: number;
}

export interface DailyLeadsData {
  date: string;
  leads: number;
  scheduled: number;
}

// ─── Webhooks ─────────────────────────────────────────────────────────────────

export interface WebhookLeadPayload {
  name: string;
  phone: string;
  email?: string;
  source?: string;
  campaign?: string;
  procedure?: string;
  custom_fields?: Record<string, unknown>;
  organization_id?: string;
}

export interface EvolutionWebhookPayload {
  event: string;
  instance: string;
  data: {
    key: {
      remoteJid: string;
      fromMe: boolean;
      id: string;
    };
    message?: {
      conversation?: string;
      imageMessage?: { url: string; mimetype: string; caption?: string };
      audioMessage?: { url: string; mimetype: string; seconds: number };
      videoMessage?: { url: string; mimetype: string; caption?: string };
      documentMessage?: { url: string; mimetype: string; fileName: string };
    };
    messageType: string;
    pushName?: string;
    timestamp: number;
  };
}

// ─── Custom Fields ────────────────────────────────────────────────────────────

export type CustomFieldType =
  | "text"
  | "number"
  | "date"
  | "select"
  | "multiselect"
  | "boolean"
  | "url";

export interface CustomField {
  id: string;
  organization_id: string;
  name: string;
  key: string;
  field_type: CustomFieldType;
  options?: string[];
  required: boolean;
  order: number;
}

// ─── Audit ────────────────────────────────────────────────────────────────────

export interface AuditLog {
  id: string;
  organization_id: string;
  actor_id?: string;
  actor?: Profile;
  action: string;
  resource_type: string;
  resource_id?: string;
  metadata?: Record<string, unknown>;
  ip_address?: string;
  created_at: string;
}
