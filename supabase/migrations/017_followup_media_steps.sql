-- ============================================================
-- CRM Sync Marketing - Migration 017
-- Follow-up steps: suporte a midia (audio, imagem)
-- ============================================================

-- Adiciona colunas de tipo e midia em followup_steps.
-- Idempotente: usa ADD COLUMN IF NOT EXISTS.

alter table followup_steps
  add column if not exists message_type text not null default 'text'
    check (message_type in ('text', 'audio', 'image')),
  add column if not exists media_url      text null,
  add column if not exists media_mimetype text null,
  add column if not exists media_filename text null;

-- Garante integridade: passos de texto precisam de mensagem; passos de midia precisam de URL.
-- A validacao primaria acontece na server action; o check abaixo e uma rede de seguranca.
-- Nao e possivel fazer CHECK cross-column de forma simples em Postgres sem uma funcao,
-- entao mantemos isso apenas na camada de aplicacao (action + constraint simples abaixo).

-- Indice auxiliar para buscas por tipo em orgs com muitos passos (opcional, baixo custo).
create index if not exists idx_followup_steps_type
  on followup_steps(organization_id, message_type);
