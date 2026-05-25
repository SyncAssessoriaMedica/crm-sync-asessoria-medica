import type { UserRole } from "./types";

const ROUTE_RULES: [string, UserRole[]][] = [
  ["/dashboard",   ["super_admin", "gestor_sync", "admin_clinica", "atendente", "leitura"]],
  ["/profile",     ["super_admin", "gestor_sync", "admin_clinica", "atendente", "leitura"]],
  ["/leads",       ["super_admin", "gestor_sync", "admin_clinica", "atendente"]],
  ["/inbox",       ["super_admin", "gestor_sync", "admin_clinica", "atendente"]],
  ["/follow-up",   ["super_admin", "gestor_sync", "admin_clinica"]],
  ["/admin",       ["super_admin", "gestor_sync", "admin_clinica"]],
  ["/settings",    ["super_admin", "gestor_sync", "admin_clinica"]],
];

// Paths that the middleware already marks as public or that live outside the
// app layout. canAccessRoute is never called for these in practice, but
// listing them explicitly makes the intent clear and prevents false-denials
// if the function is ever called defensively.
const ALWAYS_ALLOWED_PREFIXES = [
  "/api/",
  "/_next/",
  "/login",
  "/auth/",
  "/favicon",
];

export function canAccessRoute(role: string, pathname: string): boolean {
  // Check explicit role-based rules first.
  for (const [route, allowedRoles] of ROUTE_RULES) {
    if (pathname === route || pathname.startsWith(`${route}/`)) {
      return allowedRoles.includes(role as UserRole);
    }
  }

  // Allow clearly public / infrastructure paths.
  for (const prefix of ALWAYS_ALLOWED_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }

  // Unknown routes: DENY by default so newly-added pages are not accidentally
  // exposed before their access rules are defined in ROUTE_RULES.
  return false;
}

export function accessDeniedComponent(): never {
  throw new Error("ACCESS_DENIED");
}

export function canAccessInbox(role: string): boolean {
  return canAccessRoute(role, "/inbox");
}
