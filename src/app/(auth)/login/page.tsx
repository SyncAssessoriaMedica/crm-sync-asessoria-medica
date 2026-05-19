"use client";

import { useActionState, useState } from "react";
import { TrendingUp, ArrowRight, Lock, Mail, Eye, EyeOff, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = { error: null };

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [state, formAction, isPending] = useActionState(loginAction, initialState);

  return (
    <div className="flex min-h-screen bg-background-subtle">
      {/* Left panel — brand */}
      <div className="hidden lg:flex lg:w-[52%] flex-col justify-between bg-sidebar-dark p-12">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-green">
            <TrendingUp className="h-5 w-5 text-sidebar-dark" strokeWidth={2.5} />
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-sm font-black uppercase tracking-[0.18em] text-white">
              Sync Marketing
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/40">
              CRM · Inteligência Comercial
            </span>
          </div>
        </div>

        {/* Main message */}
        <div className="space-y-6">
          <div className="space-y-2">
            <p className="label-eyebrow text-brand-green">Inteligência e Escala</p>
            <h1 className="text-4xl font-black leading-tight text-white">
              Central de Comando
              <br />
              <span className="text-brand-green">da sua clínica.</span>
            </h1>
          </div>
          <p className="max-w-sm text-sm leading-relaxed text-white/50">
            Gerencie leads, acompanhe conversas no WhatsApp, meça sua
            conversão e identifique gargalos comerciais em tempo real.
          </p>
          <div className="flex gap-8 pt-4 border-t border-white/10">
            {[
              { value: "38.5%", label: "Taxa de Agendamento" },
              { value: "41.3%", label: "Taxa de Fechamento" },
              { value: "18min", label: "Tempo de Resposta" },
            ].map((stat) => (
              <div key={stat.label}>
                <p className="text-2xl font-black text-white">{stat.value}</p>
                <p className="label-eyebrow text-white/30">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="text-[11px] text-white/20">
          © {new Date().getFullYear()} Sync Marketing · Todos os direitos reservados
        </p>
      </div>

      {/* Right panel — form */}
      <div className="flex flex-1 flex-col items-center justify-center p-8">
        {/* Mobile logo */}
        <div className="mb-10 flex items-center gap-3 lg:hidden">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-green">
            <TrendingUp className="h-5 w-5 text-sidebar-dark" strokeWidth={2.5} />
          </div>
          <span className="text-lg font-black uppercase tracking-[0.12em] text-text-primary">
            Sync CRM
          </span>
        </div>

        <div className="w-full max-w-sm">
          <div className="mb-8">
            <h2 className="text-2xl font-black text-text-primary">
              Entrar na plataforma
            </h2>
            <p className="mt-1 text-sm text-text-muted">
              Acesse com suas credenciais da Sync
            </p>
          </div>

          {/* Error message */}
          {state.error && (
            <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-danger-red/20 bg-danger-soft px-3.5 py-3">
              <AlertCircle className="h-4 w-4 shrink-0 text-danger-red mt-0.5" />
              <p className="text-xs text-danger-red">{state.error}</p>
            </div>
          )}

          <form action={formAction} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">E-mail</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="seu@email.com"
                  className="pl-9"
                  required
                  autoComplete="email"
                  disabled={isPending}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Senha</Label>
                <button
                  type="button"
                  className="text-[11px] text-brand-green hover:underline"
                  tabIndex={-1}
                >
                  Esqueceu a senha?
                </button>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  className="pl-9 pr-9"
                  required
                  autoComplete="current-password"
                  disabled={isPending}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full gap-2"
              size="lg"
              disabled={isPending}
            >
              {isPending ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-sidebar-dark/30 border-t-sidebar-dark" />
                  Entrando...
                </>
              ) : (
                <>
                  Acessar plataforma
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </form>

          {/* Pillar badges */}
          <div className="mt-10 border-t border-border pt-6">
            <p className="label-eyebrow mb-3 text-center">Método Sync</p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {["Posicionamento", "Oferta", "Aquisição", "Inteligência"].map(
                (pillar) => (
                  <span
                    key={pillar}
                    className={cn(
                      "rounded-full border border-border px-2.5 py-0.5 text-[10px] font-semibold text-text-muted",
                      pillar === "Inteligência" &&
                        "border-brand-green/30 bg-brand-green-soft text-brand-green-deep"
                    )}
                  >
                    {pillar}
                  </span>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
