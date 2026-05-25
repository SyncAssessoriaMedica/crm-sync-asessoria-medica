# Sync CRM — Central de Inteligência Comercial

CRM proprietário da **Sync Marketing** para assessorias de marketing médico. Ferramenta do **4º pilar do método Sync**: Inteligência e Escala.

---

## Como rodar localmente

### Pré-requisitos

- Node.js 18+ (recomendado: 20+)
- npm 9+

### 1. Instalar dependências

```bash
npm install
```

### 2. Configurar variáveis de ambiente

```bash
cp .env.local.example .env.local
```

Edite `.env.local` com as credenciais do seu projeto Supabase:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

> **Importante:** `NEXT_PUBLIC_SUPABASE_URL` deve ser apenas a URL base — sem `/rest/v1/` ou qualquer sufixo de path.

### 3. Criar o primeiro admin

Antes de acessar o app, crie o usuário super_admin e a organização raiz:

```bash
ADMIN_EMAIL=admin@suaempresa.com \
ADMIN_PASSWORD=senha-segura-minimo8 \
ADMIN_NAME="Seu Nome" \
ORG_NAME="Sync Marketing" \
ORG_SLUG="sync-marketing" \
npm run bootstrap:admin
```

O script é idempotente — seguro de rodar múltiplas vezes.

### 4. Configurar Redirect URL no Supabase

No Supabase Dashboard → **Authentication → URL Configuration → Redirect URLs**, adicione:

```
http://localhost:3000/auth/callback
```

Para produção, adicione também: `https://seudominio.com/auth/callback`

### 5. Rodar em desenvolvimento

```bash
npm run dev
```

Acesse: [http://localhost:3000](http://localhost:3000)

A rota raiz redireciona para `/dashboard`. Se não estiver autenticado, o proxy redireciona para `/login`.

### 6. Build de produção

```bash
npm run build
npm start
```

---

## Variáveis de Ambiente

| Variável | Obrigatório | Descrição |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Fase 2 | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Fase 2 | Chave anon do Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Fase 2 | Service role key (server-side only) |
| `EVOLUTION_API_URL` | Fase 2 | URL da Evolution API auto-hospedada |
| `EVOLUTION_API_KEY` | Fase 2 | API key da Evolution API |
| `EVOLUTION_WEBHOOK_SECRET` | Producao | Secret dedicado para autenticar webhooks recebidos da Evolution; nao use a API key na URL |
| `WEBHOOK_SECRET` | Produção | Secret para autenticar webhooks externos |
| `NEXT_PUBLIC_APP_URL` | Produção | URL pública do app |

---

## Arquitetura

### Stack

| Camada | Tecnologia |
|---|---|
| Framework | Next.js 16 (App Router) |
| Linguagem | TypeScript 5 |
| Estilização | Tailwind CSS + tokens customizados |
| Componentes | shadcn/ui (Radix UI) |
| Banco de dados | Supabase Postgres |
| Auth | Supabase Auth |
| RLS | Supabase Row Level Security |
| Storage | Supabase Storage |
| Tabelas | TanStack Table |
| Gráficos | Recharts |
| Formulários | React Hook Form + Zod |
| WhatsApp | Evolution API |
| Deploy | Vercel |

### Estrutura de diretórios

```
src/
├── app/
│   ├── (auth)/
│   │   └── login/              # Página de login
│   ├── (app)/                  # Rotas autenticadas (com sidebar)
│   │   ├── layout.tsx          # Shell: Sidebar + Topbar
│   │   ├── dashboard/          # Dashboard com métricas e gráficos
│   │   ├── leads/              # Listagem de leads
│   │   │   └── [id]/           # Detalhe do lead
│   │   ├── inbox/              # Inbox WhatsApp (3 colunas)
│   │   ├── admin/              # Administração (clínicas, usuários, etc.)
│   │   └── settings/           # Configurações da clínica
│   └── api/
│       └── webhooks/
│           ├── leads/          # POST — Entrada de leads externos
│           └── evolution/      # POST — Webhooks da Evolution API
├── components/
│   ├── layout/
│   │   ├── sidebar.tsx         # Navegação lateral dark
│   │   └── topbar.tsx          # Barra superior com período e user
│   ├── dashboard/
│   │   └── metric-card.tsx     # Cards de KPI com variação %
│   └── ui/                     # Componentes shadcn customizados
├── lib/
│   ├── types.ts                # Tipos TypeScript completos
│   ├── utils.ts                # Formatadores (moeda, data, telefone...)
│   ├── supabase/
│   │   ├── client.ts           # Browser client (SSR-safe)
│   │   └── server.ts           # Server client + admin client
│   └── mock-data/              # Dados mockados para MVP
│       ├── dashboard.ts
│       ├── leads.ts
│       └── conversations.ts
├── proxy.ts                    # Auth proxy (Next.js 16 — protege rotas autenticadas)
supabase/
└── migrations/
    ├── 001_initial_schema.sql  # Schema multi-tenant completo
    ├── 002_rls_policies.sql    # Políticas de isolamento por tenant
    └── 003_seed_data.sql       # Triggers e dados iniciais
```

### Modelo multi-tenant

Cada **organização** (clínica) é um tenant isolado. O isolamento é garantido por:

1. **Coluna `organization_id`** em todas as tabelas de dados.
2. **RLS (Row Level Security)** no Supabase — nenhuma query vaza dados entre tenants.
3. **Funções helper** (`get_user_org_ids`, `is_sync_staff`) que determinam o contexto do usuário.

### Perfis de usuário

| Perfil | Acesso |
|---|---|
| `super_admin` | Todas as clínicas e configurações globais |
| `gestor_sync` | Acompanhamento de todas as clínicas da assessoria |
| `admin_clinica` | Gestão completa da própria clínica |
| `atendente` | Leads e conversas da própria clínica |
| `leitura` | Apenas visualização (sem edição) |

---

## Webhooks

### Entrada de leads externos

```http
POST /api/webhooks/leads
Content-Type: application/json
x-webhook-secret: seu-secret

{
  "name": "Ana Carolina",
  "phone": "11987654321",
  "email": "ana@email.com",
  "source": "Meta Ads",
  "campaign": "Rinoplastia SP",
  "procedure": "Rinoplastia",
  "organization_id": "uuid-da-clinica"
}
```

**Resposta:**
```json
{
  "success": true,
  "action": "created",
  "lead_id": "uuid"
}
```

### Evolution API (WhatsApp)

```http
POST /api/webhooks/evolution
apikey: sua-evolution-key
Content-Type: application/json

{ ...payload da Evolution API... }
```

Configure na Evolution API o webhook URL como:
`https://seu-dominio.com/api/webhooks/evolution`

---

## Setup — Supabase

### 1. Criar projeto no Supabase

1. Acesse [supabase.com](https://supabase.com)
2. Crie um novo projeto
3. Copie `Project URL` e `anon key` para `.env.local`
4. Copie `service_role key` para `SUPABASE_SERVICE_ROLE_KEY`

> Use apenas a URL base: `https://xxxx.supabase.co` — sem sufixos.

### 2. Rodar migrations

No Supabase Dashboard → SQL Editor, execute as migrations em ordem:

```
supabase/migrations/001_initial_schema.sql
supabase/migrations/002_rls_policies.sql
supabase/migrations/003_seed_data.sql
```

### 3. Configurar Auth

No Supabase Dashboard → Authentication:
- Email/Password: habilitado (padrão)
- Redirect URLs: adicionar `http://localhost:3000/auth/callback`
- Para produção: adicionar `https://seudominio.com/auth/callback`

### 4. Criar primeiro admin

```bash
ADMIN_EMAIL=admin@suaempresa.com \
ADMIN_PASSWORD=senha-segura \
ADMIN_NAME="Seu Nome" \
ORG_NAME="Sync Marketing" \
ORG_SLUG="sync-marketing" \
npm run bootstrap:admin
```

O script cria o usuário no Supabase Auth, o perfil em `profiles`, a organização e o membership com role `super_admin`. É idempotente.

### 5. Próximo passo — substituir mock-data

As páginas ainda usam dados de `src/lib/mock-data/`. Para conectar ao banco real:
- Substituir imports de `@/lib/mock-data/*` por queries ao Supabase
- Server Components: `import { createClient } from "@/lib/supabase/server"`
- Client Components: `import { createClient } from "@/lib/supabase/client"`

---

## Próximos passos — Evolution API

### 1. Instanciar Evolution API

```bash
docker run -d \
  -e SERVER_URL=https://api.seudominio.com \
  -e AUTHENTICATION_API_KEY=sua-api-key \
  atendai/evolution-api:latest
```

### 2. Criar instância WhatsApp

```bash
curl -X POST https://api.seudominio.com/instance/create \
  -H "apikey: sua-api-key" \
  -d '{"instanceName": "clinica-sp-principal"}'
```

### 3. Configurar webhook

```bash
curl -X POST https://api.seudominio.com/webhook/set/clinica-sp-principal \
  -H "apikey: sua-api-key" \
  -d '{
    "url": "https://crm.syncmarketing.com.br/api/webhooks/evolution",
    "enabled": true,
    "events": ["MESSAGES_UPSERT", "CONNECTION_UPDATE"]
  }'
```

---

## Deploy na Vercel via GitHub

O deploy é feito pela integração nativa Vercel ↔ GitHub. Cada push na branch `main` dispara um deploy automático. Nenhum login na Vercel é necessário para deploys futuros — basta fazer push no GitHub.

### 1. Importar o repositório

1. Acesse [vercel.com/new](https://vercel.com/new)
2. Selecione **"Import Git Repository"**
3. Conecte sua conta GitHub se necessário
4. Encontre e selecione o repositório `crm-sync-asessoria-medica`
5. Clique em **Import**

### 2. Configurar o projeto

Na tela de configuração:

| Campo | Valor |
|---|---|
| Framework Preset | **Next.js** (detectado automaticamente) |
| Root Directory | `.` (raiz do repositório) |
| Build Command | `npm run build` (padrão) |
| Output Directory | `.next` (padrão) |
| Branch de produção | `main` |

### 3. Cadastrar variáveis de ambiente

Antes de clicar em **Deploy**, clique em **"Environment Variables"** e adicione:

| Variável | Ambiente | Descrição |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Production, Preview | URL base do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production, Preview | Chave anon pública do Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Production | Service role key — nunca expor no frontend |
| `EVOLUTION_API_URL` | Production | URL da Evolution API auto-hospedada |
| `EVOLUTION_API_KEY` | Production | API key da Evolution API |
| `EVOLUTION_WEBHOOK_SECRET` | Production | Secret dedicado para autenticar webhooks recebidos da Evolution; obrigatorio em producao |
| `WEBHOOK_SECRET` | Production | Secret para autenticar webhooks externos |
| `NEXT_PUBLIC_APP_URL` | Production | URL final do app na Vercel (preencher após primeiro deploy) |
| `CRON_SECRET` | Production | Secret para autenticar o cron de follow-up; gerado com `openssl rand -hex 32` |

> `SUPABASE_SERVICE_ROLE_KEY` deve ser adicionada apenas em **Production** — nunca em Preview/Development.

### 4. Fazer o primeiro deploy

Clique em **Deploy**. A Vercel irá:
1. Clonar o repositório
2. Instalar dependências (`npm install`)
3. Rodar o build (`npm run build`)
4. Publicar na URL gerada (ex: `crm-sync-asessoria-medica.vercel.app`)

### 5. Deploys automáticos

Após a integração, o fluxo é:

```
commit local → git push origin main → Vercel detecta → build → deploy automático
```

- **Branch `main`** → deploy em produção
- **Outras branches / Pull Requests** → deploy de preview com URL própria

Nenhum login na Vercel é necessário para este fluxo. Qualquer push autorizado no GitHub dispara o deploy automaticamente.

### 6. Após o primeiro deploy — configurar Supabase

Com a URL da Vercel em mãos (ex: `https://crm-sync-asessoria-medica.vercel.app`):

**a) Atualizar `NEXT_PUBLIC_APP_URL` na Vercel:**

Vercel Dashboard → Projeto → Settings → Environment Variables → edite `NEXT_PUBLIC_APP_URL` → Redeploy.

**b) Adicionar Redirect URL no Supabase:**

Supabase Dashboard → Authentication → URL Configuration → Redirect URLs → adicione:

```
https://SUA-URL.vercel.app/auth/callback
```

**c) Retomar Supabase/Auth:**

Com o app no ar e Redirect URL configurado:
- Rodar `npm run bootstrap:admin` para criar o primeiro admin
- Testar login em produção
- Substituir mock-data por queries reais ao Supabase gradualmente

---

## Follow-up Automático

O módulo envia mensagens de acompanhamento via WhatsApp de forma automática, em sequência configurável, respeitando horários comerciais.

### Como funciona

1. **Ciclo:** Cada mensagem manual (outbound) enviada por um atendente inicia ou reinicia o ciclo de follow-up para aquela conversa.
2. **Sequência:** Cada passo define quantos dias após o início do ciclo a mensagem deve ser enviada (ex.: passo 1 = dia 2, passo 2 = dia 5, passo 3 = dia 10).
3. **Cron:** O endpoint `/api/cron/followups` está agendado na Vercel com frequência diária para manter compatibilidade com o plano Hobby. Para execução a cada 15 minutos, use Vercel Pro ou um cron externo chamando o endpoint autenticado.
4. **Fase 1 — Scheduler:** O cron detecta conversas elegíveis e cria itens na fila com `status = pending`.
5. **Fase 2 — Sender:** O cron pega até 20 itens pendentes (1 por instância WhatsApp), verifica horário comercial e envia via Evolution API.

### Condições de bloqueio (não envia se)

- Lead tem `followup_paused = true` (pausado manualmente na ficha do lead)
- Etapa do funil do lead está na lista de etapas bloqueadas
- Lead possui alguma tag bloqueada
- Instância WhatsApp está desconectada
- Horário atual fora da janela configurada (→ adiado para próxima janela)

### Configuração

Acesse **Follow-up Auto** no menu lateral (roles: `super_admin`, `gestor_sync`, `admin_clinica`):

1. **Status** — Ativar/desativar por organização e definir fuso horário
2. **Sequência** — Criar passos com ordem, delay em dias e texto da mensagem (suporte a `{nome}`)
3. **Horário de Envio** — Configurar janela de envio por dia da semana
4. **Etapas Bloqueadas** — Marcar etapas que pausam o follow-up
5. **Tags Bloqueadas** — Marcar tags que pausam o follow-up
6. **Fila** — Ver e cancelar itens pendentes
7. **Histórico** — Auditoria dos últimos 100 eventos

### Variáveis necessárias na Vercel

```
CRON_SECRET=<openssl rand -hex 32>
EVOLUTION_API_URL=https://sua-evolution-api.com
EVOLUTION_API_KEY=sua-api-key
```

### Rodar migration

No Supabase SQL Editor, execute:

```
supabase/migrations/010_automatic_followups.sql
```

### Testar manualmente

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://seu-app.vercel.app/api/cron/followups
```

Em desenvolvimento (com `CRON_SECRET` no `.env.local`):

```bash
curl "http://localhost:3000/api/cron/followups?secret=$CRON_SECRET"
```

---

## Roadmap

### Fase 1 — Fundação (atual)
- [x] Autenticação real com Supabase Auth (email/password)
- [x] Proteção de rotas via proxy (Next.js 16)
- [x] Callback PKCE (`/auth/callback`)
- [x] Script de bootstrap do primeiro admin
- [x] Multi-tenant com RLS
- [x] Layout com identidade Sync
- [x] Dashboard com KPIs
- [x] Histórico de leads (listagem + detalhe)
- [x] Webhook de entrada de leads
- [x] Admin básico

### Fase 2 — WhatsApp
- [x] Conectar Evolution API real
- [x] Recebimento de webhooks
- [x] Inbox com mensagens reais
- [x] Criação automática de leads por WhatsApp
- [x] Suporte a mídia (imagem, áudio, vídeo, documento)
- [x] **Follow-up Automático** — sequência de mensagens com delay, horários comerciais, bloqueios por etapa/tag

### Fase 3 — Inteligência Comercial
- [ ] Relatórios de reunião
- [ ] Alertas automáticos (lead sem resposta, sem follow-up)
- [ ] Comparativo por atendente / campanha / origem
- [ ] CPL, CAC, ROI quando houver dados de investimento

### Fase 4 — SaaS
- [ ] Controle de planos e assinaturas
- [ ] Bloqueio/desbloqueio de acesso
- [ ] Exportação final ao cancelar assessoria
- [ ] Portal da clínica autônomo

---

© 2024 Sync Marketing — Todos os direitos reservados.
