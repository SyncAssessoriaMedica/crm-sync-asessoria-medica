import type { LeadStatus, PipelineStage, LeadSource } from "@/lib/types";

export type LeadTagItem = {
  id: string;
  name: string;
  color: string;
};

export type LeadTagRelation = {
  tags: LeadTagItem | LeadTagItem[] | null;
};

export type LeadCustomValueItem = {
  field_id: string;
  value: string | null;
};

export type LeadListItem = {
  id: string;
  organization_id: string;
  name: string;
  phone: string;
  email: string | null;
  source_id: string | null;
  source: LeadSource | null;
  procedure: string | null;
  stage_id: string | null;
  stage: PipelineStage | null;
  status: LeadStatus;
  potential_value: number | null;
  closed_value: number | null;
  observations: string | null;
  phone_country: string | null;
  phone_ddd: string | null;
  detected_state: string | null;
  detected_region: string | null;
  detected_city: string | null;
  location_confidence: "high" | "medium" | "low" | "unknown";
  service_area_status: "inside" | "possible" | "outside" | "unknown";
  location_manually_edited: boolean;
  location_updated_at: string | null;
  last_interaction_at: string | null;
  appointment_scheduled_at: string | null;
  followup_paused: boolean;
  no_followup_48h?: boolean;
  inbox_conversation_id?: string | null;
  created_at: string;
  updated_at: string;
  lead_tags: LeadTagRelation[];
  custom_field_values: LeadCustomValueItem[];
};

export type LeadOptionData = {
  sources: LeadSource[];
  stages: PipelineStage[];
  customFields: CustomFieldItem[];
  tags: LeadTagItem[];
};

export type CustomFieldItem = {
  id: string;
  organization_id: string;
  name: string;
  key: string;
  field_type: "text" | "number" | "date" | "select" | "multiselect" | "boolean" | "url";
  options: string[] | null;
  required: boolean;
  order: number;
  created_at: string;
};

export type CustomFieldValueItem = {
  id: string;
  lead_id: string;
  field_id: string;
  value: string | null;
};

export type LeadNoteItem = {
  id: string;
  content: string;
  created_at: string;
  author: { full_name: string; email: string } | null;
};

export type LeadEventItem = {
  id: string;
  event_type: string;
  description: string;
  created_at: string;
};

export type LeadTaskItem = {
  id: string;
  title: string;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
};
