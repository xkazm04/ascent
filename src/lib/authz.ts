// Org-scoped authorization for the API routes. There is no Next middleware (Next only runs
// middleware at the project root / src/middleware.ts, and none exists), so auth must be enforced
// per-handler: every mutating or token-minting org endpoint calls requireOrgAccess(). This mirrors
// the read-side model in readableOrgForOwner — auth-off deployments are open (local/demo), the
// shared "public" org is actable by anyone (the free funnel), and a real org requires a session
// whose GitHub-App installations include it.

import { NextResponse } from "next/server";
import { getSession, isAuthConfigured, PUBLIC_ORG } from "@/lib/auth";

/** True when the current session's installations include `org` (case-insensitive). */
export async function sessionOwnsOrg(org: string): Promise<boolean> {
  const slug = org.trim().toLowerCase();
  const session = await getSession();
  return Boolean(session?.installations.some((i) => i.login.toLowerCase() === slug));
}

/** True when `installationId` belongs to one of the current session's installations. */
export async function sessionHasInstallation(installationId: string | number): Promise<boolean> {
  const id = String(installationId);
  const session = await getSession();
  return Boolean(session?.installations.some((i) => String(i.id) === id));
}

/**
 * Gate a mutating / scanning org endpoint. Returns a NextResponse (401/403) to send back when the
 * caller may NOT act on `org`, or null when access is allowed. Auth-off deployments are open; the
 * shared "public" org is open (the free funnel); a real org requires a session whose installations
 * include it. Call at the top of every mutating /api/org/* (and token-minting /api/app/*) handler.
 */
export async function requireOrgAccess(org: string): Promise<NextResponse | null> {
  if (!isAuthConfigured()) return null;
  const slug = org.trim().toLowerCase();
  if (slug === PUBLIC_ORG) return null;
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in to manage this organization." }, { status: 401 });
  }
  if (!session.installations.some((i) => i.login.toLowerCase() === slug)) {
    return NextResponse.json({ error: "You don't have access to this organization." }, { status: 403 });
  }
  return null;
}

/**
 * Read-side tenant gate for org-scoped pages/APIs — distinct from requireOrgAccess (which gates
 * mutations). Returns whether `org` may be READ in the current request context. PUBLIC_ORG is
 * always readable (the shared funnel). When auth IS configured, a private org requires a session
 * whose installations include it (closing the cross-tenant read IDOR). When auth is NOT
 * configured, ONLY PUBLIC_ORG is readable: a deployment with DATABASE_URL set but OAuth unset must
 * not serve per-tenant data to anonymous callers just because "auth is off" — a dropped
 * AUTH_SECRET would otherwise turn every stored org's dashboard/usage public. Callers gate on
 * isDbConfigured() first (no DB ⇒ no per-tenant data exists to leak).
 */
export async function canReadOrg(org: string): Promise<boolean> {
  const slug = org.trim().toLowerCase();
  if (slug === PUBLIC_ORG) return true;
  if (!isAuthConfigured()) return false;
  return sessionOwnsOrg(slug);
}
