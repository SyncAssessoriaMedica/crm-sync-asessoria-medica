-- Migration 007: configurable business hours per organization

alter table organization_settings
  add column if not exists business_hours jsonb;
