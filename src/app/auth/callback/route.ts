import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Auth Callback Handler
 *
 * Obrigatório para:
 * - Email confirmation (link de confirmação de cadastro)
 * - Magic link
 * - OAuth (Google, GitHub, etc.)
 *
 * Como funciona:
 * 1. Supabase redireciona para esta URL com ?code=...
 * 2. Trocamos o code por uma sessão (exchangeCodeForSession)
 * 3. Redirecionamos para /dashboard (ou 'next' da query string)
 *
 * Configure no Supabase Dashboard:
 * Authentication → URL Configuration → Redirect URLs
 * Adicionar: http://localhost:3000/auth/callback
 *            https://seudominio.com/auth/callback
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  // Supabase pode retornar erros (ex: link expirado)
  if (error) {
    console.error(`[auth/callback] Supabase error: ${error} — ${errorDescription}`);
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(errorDescription ?? error)}`
    );
  }

  if (code) {
    const supabase = await createClient();
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

    if (exchangeError) {
      console.error("[auth/callback] exchangeCodeForSession error:", exchangeError.message);
      return NextResponse.redirect(
        `${origin}/login?error=${encodeURIComponent("Link inválido ou expirado. Solicite um novo.")}`
      );
    }

    // Garantir que o redirect é para um caminho interno (evitar open redirect)
    const safeNext = next.startsWith("/") ? next : "/dashboard";
    return NextResponse.redirect(`${origin}${safeNext}`);
  }

  // Nenhum code — redirecionar para login
  return NextResponse.redirect(`${origin}/login`);
}
