import type { LeadStatus, PipelineStage, LeadSource } from "@/lib/types";

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
  last_interaction_at: string | null;
  created_at: string;
  updated_at: string;
};

export type LeadOptionData = {
  sources: LeadSource[];
  stages: PipelineStage[];
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
