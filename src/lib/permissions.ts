import type { UserRole } from "./types";

const ROUTE_RULES: [string, UserRole[]][] = [
  ["/dashboard", ["super_admin", "gestor_sync", "admin_clinica", "atendente", "leitura"]],
  ["/profile", ["super_admin", "gestor_sync", "admin_clinica", "atendente", "leitura"]],
  ["/leads", ["super_admin", "gestor_sync", "admin_clinica", "atendente"]],
  ["/inbox", ["super_admin", "gestor_sync", "admin_clinica", "atendente"]],
  ["/admin", ["super_admin", "gestor_sync", "admin_clinica"]],
  ["/settings", ["super_admin", "gestor_sync", "admin_clinica"]],
];

export function canAccessRoute(role: string, pathname: string): boolean {
  for (const [route, allowedRoles] of ROUTE_RULES) {
    if (pathname === route || pathname.startsWith(`${route}/`)) {
      return allowedRoles.includes(role as UserRole);
    }
  }
  return true;
}

export function accessDeniedComponent(): never {
  throw new Error("ACCESS_DENIED");
}
