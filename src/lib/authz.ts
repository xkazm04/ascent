// Org-scoped authorization for the API routes. There is no Next middleware (Next only runs
// middleware at the project root / src/middleware.ts, and none exists), so auth must be enforced
// per-handler: every mutating or token-minting org endpoint calls requireOrgAccess(). This mirrors
// the read-side model in readableOrgForOwner — auth-off deployments are open (local/demo), the
// shared "public" org is actable by anyone (the free funnel), and a real org requires a session
// whose GitHub-App installations include it.

import { NextResponse } from "next/server";
import { getSession, isAuthConfigured, PUBLIC_ORG } from "@/lib/auth";
import { ensureOwnerMembership, getMembershipRole, roleAtLeast, type OrgRole } from "@/lib/db/members";

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
  if (!isAuthConfigured()) return openOrgDashboardsEnabled();
  return sessionOwnsOrg(slug);
}

/**
 * Read-side gate as a ready-to-return Response — the read sibling of {@link requireOrgAccess}.
 * Returns a 401/403 NextResponse when `org` may NOT be read in the current request context, or null
 * when allowed. Use at the top of every org-scoped READ API (GET /api/org/*, /api/audit) so a
 * non-member can't read another tenant's data (closes the cross-tenant read IDOR). Gate on
 * isDbConfigured() first (no DB ⇒ no per-tenant data to leak).
 */
export async function requireOrgRead(org: string): Promise<NextResponse | null> {
  if (await canReadOrg(org)) return null;
  if (isAuthConfigured()) {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Sign in to view this organization." }, { status: 401 });
    }
    return NextResponse.json({ error: "You don't have access to this organization." }, { status: 403 });
  }
  return NextResponse.json(
    { error: "Per-organization data requires authentication to be configured." },
    { status: 403 },
  );
}

/**
 * Local/demo/e2e opt-in: when OAuth is unconfigured, open per-org dashboards IF explicitly enabled
 * via ASCENT_OPEN_ORG_DASHBOARDS. Default OFF, so a production box that merely lost its AUTH_SECRET
 * still won't leak per-tenant data — only a deployment that deliberately sets this flag (the
 * seeding / org-e2e workflow, which runs auth-off against a seeded org) opens them. The matching
 * write path (requireOrgAccess) is already open when auth is off, so this only closes the read gap.
 */
export function openOrgDashboardsEnabled(): boolean {
  const v = process.env.ASCENT_OPEN_ORG_DASHBOARDS;
  return v === "1" || v === "true";
}

/**
 * Role-gated authorization — the RBAC layer over {@link requireOrgAccess}. Returns a NextResponse
 * (401/403) when the caller's role in `org` is below `min`, or null when allowed. Role resolution: an
 * explicit Membership row wins; otherwise an installation-owner (sessionOwnsOrg) is treated as `owner`
 * and seeded as one (so the role persists). Auth-off deployments and PUBLIC_ORG are open, mirroring
 * requireOrgAccess. Use for owner/admin-only actions: billing/credit grants, member admin, destructive
 * deletes. For "any member may act" use requireOrgAccess; for reads use requireOrgRead.
 */
export async function requireOrgRole(org: string, min: OrgRole): Promise<NextResponse | null> {
  if (!isAuthConfigured()) return null;
  const slug = org.trim().toLowerCase();
  if (slug === PUBLIC_ORG) return null;
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in to manage this organization." }, { status: 401 });
  }
  let role = await getMembershipRole(slug, session.login);
  if (!role && (await sessionOwnsOrg(slug))) {
    // Installing the GitHub App requires org-admin on GitHub, so an installation-owner is the org's
    // owner here. Seed the membership so the role is persisted and member management has an anchor.
    await ensureOwnerMembership(slug, session.login, session.name).catch(() => {});
    role = "owner";
  }
  if (roleAtLeast(role, min)) return null;
  return NextResponse.json(
    { error: `This action requires the ${min} role in this organization.` },
    { status: 403 },
  );
}
