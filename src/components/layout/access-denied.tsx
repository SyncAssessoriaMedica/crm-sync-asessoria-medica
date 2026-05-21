import Link from "next/link";
import { ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AccessDenied({ redirectTo = "/dashboard" }: { redirectTo?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-danger-soft">
        <ShieldX className="h-7 w-7 text-danger-red" />
      </div>
      <p className="label-eyebrow text-danger-red">Acesso Restrito</p>
      <h1 className="mt-2 text-xl font-black text-text-primary">Sem permissao para esta area</h1>
      <p className="mt-2 max-w-sm text-sm text-text-secondary">
        Seu perfil nao tem acesso a esta pagina. Fale com um administrador se precisar de acesso.
      </p>
      <Button asChild className="mt-6">
        <Link href={redirectTo}>Voltar ao dashboard</Link>
      </Button>
    </div>
  );
}
