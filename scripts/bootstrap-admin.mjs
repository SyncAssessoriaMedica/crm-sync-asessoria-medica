/**
 * Bootstrap Admin Script
 *
 * Cria o primeiro super_admin e a organização raiz no Supabase.
 * Idempotente: seguro de rodar múltiplas vezes.
 *
 * Uso:
 *   npm run bootstrap:admin
 *
 * Ou com variáveis explícitas:
 *   ADMIN_EMAIL=x@y.com ADMIN_PASSWORD=... ADMIN_NAME="..." \
 *   ORG_NAME="Minha Clínica" ORG_SLUG="minha-clinica" \
 *   npm run bootstrap:admin
 *
 * Argumentos CLI (sobrepõem env vars):
 *   --email, --password, --name, --org-name, --org-slug
 */

import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Parse CLI args (--key=value or --key value)
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const [key, ...rest] = arg.slice(2).split("=");
      const value = rest.length ? rest.join("=") : args[++i];
      result[key] = value;
    }
  }
  return result;
}

const cli = parseArgs();

function get(cliKey, envKey, fallback) {
  return cli[cliKey] ?? process.env[envKey] ?? fallback;
}

// ---------------------------------------------------------------------------
// Config — all required values must be set
// ---------------------------------------------------------------------------
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ADMIN_EMAIL = get("email", "ADMIN_EMAIL", "");
const ADMIN_PASSWORD = get("password", "ADMIN_PASSWORD", "");
const ADMIN_NAME = get("name", "ADMIN_NAME", "Super Admin");
const ORG_NAME = get("org-name", "ORG_NAME", "Sync Marketing");
const ORG_SLUG = get("org-slug", "ORG_SLUG", "sync-marketing");

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const errors = [];
if (!SUPABASE_URL) errors.push("NEXT_PUBLIC_SUPABASE_URL não definida.");
if (!SERVICE_ROLE_KEY) errors.push("SUPABASE_SERVICE_ROLE_KEY não definida.");
if (!ADMIN_EMAIL) errors.push("ADMIN_EMAIL não definida (ou --email).");
if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 8)
  errors.push("ADMIN_PASSWORD não definida ou muito curta (mín. 8 chars) (ou --password).");

if (errors.length) {
  console.error("\n❌  Erros de configuração:\n");
  errors.forEach((e) => console.error(`   • ${e}`));
  console.error(
    "\nDefina as variáveis em .env.local e rode: npm run bootstrap:admin\n"
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Supabase admin client (service_role — bypasses RLS)
// ---------------------------------------------------------------------------
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function log(msg) {
  console.log(`  ${msg}`);
}

function ok(msg) {
  console.log(`  ✅  ${msg}`);
}

function skip(msg) {
  console.log(`  ⏭️   ${msg}`);
}

function fail(msg, err) {
  console.error(`  ❌  ${msg}`);
  if (err) console.error("      ", err.message ?? err);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("\n🚀  Bootstrap Admin — CRM Sync Marketing\n");
  console.log(`   Email:        ${ADMIN_EMAIL}`);
  console.log(`   Nome:         ${ADMIN_NAME}`);
  console.log(`   Organização:  ${ORG_NAME} (${ORG_SLUG})`);
  console.log("");

  // 1. Upsert auth user -------------------------------------------------------
  log("Verificando usuário no Supabase Auth...");

  const { data: listData, error: listError } =
    await supabase.auth.admin.listUsers({ perPage: 1000 });

  if (listError) fail("Não foi possível listar usuários.", listError);

  const existingUser = listData.users.find((u) => u.email === ADMIN_EMAIL);
  let userId;

  if (existingUser) {
    userId = existingUser.id;
    skip(`Usuário já existe (id: ${userId}).`);
  } else {
    const { data: created, error: createError } =
      await supabase.auth.admin.createUser({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: ADMIN_NAME },
      });

    if (createError) fail("Não foi possível criar usuário.", createError);
    userId = created.user.id;
    ok(`Usuário criado (id: ${userId}).`);
  }

  // 2. Upsert organization ----------------------------------------------------
  log("Verificando organização...");

  const { data: existingOrg, error: orgSelectError } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", ORG_SLUG)
    .maybeSingle();

  if (orgSelectError) fail("Erro ao consultar organizations.", orgSelectError);

  let orgId;

  if (existingOrg) {
    orgId = existingOrg.id;
    skip(`Organização já existe (id: ${orgId}).`);
  } else {
    const { data: newOrg, error: orgInsertError } = await supabase
      .from("organizations")
      .insert({ name: ORG_NAME, slug: ORG_SLUG })
      .select("id")
      .single();

    if (orgInsertError)
      fail("Não foi possível criar organização.", orgInsertError);
    orgId = newOrg.id;
    ok(`Organização criada (id: ${orgId}).`);
  }

  // 3. Upsert profile ----------------------------------------------------------
  log("Verificando perfil...");

  const { error: profileError } = await supabase
    .from("profiles")
    .upsert(
      { id: userId, full_name: ADMIN_NAME, email: ADMIN_EMAIL },
      { onConflict: "id" }
    );

  if (profileError) fail("Não foi possível criar/atualizar perfil.", profileError);
  ok("Perfil sincronizado.");

  // 4. Upsert organization_members -------------------------------------------
  log("Verificando membership...");

  const { error: memberError } = await supabase
    .from("organization_members")
    .upsert(
      {
        organization_id: orgId,
        user_id: userId,
        role: "super_admin",
      },
      { onConflict: "organization_id,user_id" }
    );

  if (memberError)
    fail("Não foi possível criar/atualizar membership.", memberError);
  ok("Membership super_admin configurado.");

  // ---------------------------------------------------------------------------
  console.log("\n✅  Bootstrap concluído com sucesso!\n");
  console.log("   Próximos passos:");
  console.log(`   1. Acesse ${SUPABASE_URL.replace("supabase.co", "supabase.co")}`);
  console.log("      → Authentication → URL Configuration → Redirect URLs");
  console.log("      Adicione: http://localhost:3000/auth/callback");
  console.log("   2. Rode: npm run dev");
  console.log(`   3. Faça login com: ${ADMIN_EMAIL}\n`);
}

main().catch((err) => {
  console.error("\n❌  Erro inesperado:", err);
  process.exit(1);
});
