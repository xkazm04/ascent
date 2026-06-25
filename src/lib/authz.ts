// Org-scoped authorization for the API routes. There is no Next middleware (Next only runs
// middleware at the project root / src/middleware.ts, and none exists), so auth must be enforced
// per-handler: every mutating or token-minting org endpoint calls requireOrgAccess(). This mirrors
// the read-side model in readableOrgForOwner — auth-off deployments are open (local/demo), the
// shared "public" org is actable by anyone (the free funnel), and a real org requires a session
// whose GitHub-App installations include it.

import { NextResponse } from "next/server";
import { getSession, isAuthConfigured, PUBLIC_ORG } from "@/lib/auth";
import { authGateEnabled, getViewer, requireViewer, type Viewer } from "@/lib/access";
import { envBool } from "@/lib/env";
import { getInstallationIdForOwner, isDbConfigured } from "@/lib/db";
import { isAppConfigured, isOrgAdminViaInstallation } from "@/lib/github/app";
import { ensureOwnerMembership, getMembershipRole, orgHasOwner, roleAtLeast, type OrgRole } from "@/lib/db/members";

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
 * Resolve the signed-in viewer's effective role in `org` under the Supabase login wall — the SHARED
 * resolver behind every gate (read / write / RBAC) so their tenant decisions can't drift. Returns the
 * role (possibly just-seeded) or null when the viewer has no standing in the org.
 *
 * Trust-on-first-use is now BOUND TO IDENTITY, closing the owner land-grab: previously the first
 * signed-in viewer to touch ANY ownerless org (e.g. one the scan pipeline's ensureOrgId created) was
 * seeded as its owner, so a stranger could claim a victim's org. An as-yet-unowned org is seeded to the
 * viewer as `owner` ONLY when the viewer is provably entitled to it:
 *   • the viewer's OWN personal namespace (login === slug), which an attacker can't spoof to a victim; or
 *   • a GitHub-CONFIRMED admin of the org backing the installation (isOrgAdminViaInstallation — fails
 *     closed, so a stranger never passes).
 * An already-owned org is never auto-claimed (it grows via invites/member admin). A viewer who is
 * neither a member, the personal owner, nor a confirmed org admin gets null — no access, no seed.
 */
async function viewerOrgRole(slug: string, viewer: Viewer): Promise<OrgRole | null> {
  const existing = await getMembershipRole(slug, viewer.login);
  if (existing) return existing;
  // Only an as-yet-unowned org is eligible for the identity-bound bootstrap; an owned org is a hard
  // wall (membership/invite only) — the cross-tenant-takeover invariant.
  if (await orgHasOwner(slug)) return null;
  let entitled = slug === viewer.login.trim().toLowerCase();
  if (!entitled && isAppConfigured() && isDbConfigured()) {
    // GitHub-verified onboarding for an ORG installation — the install-verified claim the lazy
    // first-touch seeding lacked. Fails closed on any error / missing permission.
    const installId = await getInstallationIdForOwner(slug).catch(() => null);
    if (installId) entitled = await isOrgAdminViaInstallation(installId, slug, viewer.login).catch(() => false);
  }
  if (!entitled) return null;
  await ensureOwnerMembership(slug, viewer.login, viewer.name).catch(() => {});
  return "owner";
}

/**
 * Gate a mutating / scanning org endpoint. Returns a NextResponse (401/403) to send back when the
 * caller may NOT act on `org`, or null when access is allowed. Auth-off deployments are open; the
 * shared "public" org is open (the free funnel); a real org requires a session whose installations
 * include it. Call at the top of every mutating /api/org/* (and token-minting /api/app/*) handler.
 */
export async function requireOrgAccess(org: string): Promise<NextResponse | null> {
  // Supabase login wall (layered on top): when enforced, require a signed-in viewer first.
  const gate = await requireViewer();
  if (gate) return gate;
  const slug = org.trim().toLowerCase();
  if (slug === PUBLIC_ORG) return null;
  // Supabase login wall: a signed-in viewer may act on an org ONLY with a real membership (>= member),
  // not merely by being signed in. The old `if (!isAuthConfigured()) return null` treated the dormant
  // custom OAuth as "auth off" and let ANY viewer mutate ANY org — the cross-tenant write IDOR.
  if (authGateEnabled()) {
    const viewer = await getViewer();
    if (!viewer) return NextResponse.json({ error: "Sign in to manage this organization." }, { status: 401 });
    if (roleAtLeast(await viewerOrgRole(slug, viewer), "member")) return null;
    return NextResponse.json({ error: "You don't have access to this organization." }, { status: 403 });
  }
  // Custom GitHub OAuth path (dormant under the Supabase wall) and fully auth-off (local/demo).
  if (!isAuthConfigured()) return null;
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
  // Supabase login wall: reading a private org requires a real standing in it (>= viewer), resolved
  // exactly like the write/RBAC gates. The old blanket `Boolean(await getViewer())` let ANY signed-in
  // viewer read ANY org — the cross-tenant read IDOR. viewerOrgRole only ever seeds for an
  // identity-verified viewer, so a stranger reading a victim org gets null ⇒ false (no access, no seed).
  if (authGateEnabled()) {
    const viewer = await getViewer();
    if (!viewer) return false;
    return roleAtLeast(await viewerOrgRole(slug, viewer), "viewer");
  }
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
  // Supabase login wall: canReadOrg returns false for a signed-out viewer (401, sign in) OR a signed-in
  // viewer with no standing in this org (403 — authenticated but not a member; the cross-tenant read IDOR).
  if (authGateEnabled()) {
    if (await getViewer()) {
      return NextResponse.json({ error: "You don't have access to this organization." }, { status: 403 });
    }
    return NextResponse.json({ error: "Sign in to view this organization." }, { status: 401 });
  }
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
  return envBool("ASCENT_OPEN_ORG_DASHBOARDS");
}

/**
 * Boolean form of {@link requireOrgRole} for server COMPONENTS (pages), which need a yes/no rather
 * than a Response to return. Same resolution + owner-seed side effect; true when the caller's role
 * in `org` meets `min`. Use to gate an owner-only page (e.g. Members) before reading its data.
 */
export async function hasOrgRole(org: string, min: OrgRole): Promise<boolean> {
  return (await requireOrgRole(org, min)) === null;
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
  const gate = await requireViewer();
  if (gate) return gate;
  const slug = org.trim().toLowerCase();
  if (slug === PUBLIC_ORG) return null;

  // Supabase login wall: resolve a REAL membership role for the signed-in viewer (the shared
  // viewerOrgRole resolver) rather than blanket-allowing every viewer. The old `if (!isAuthConfigured())
  // return null` treated "custom OAuth dormant" as "auth off ⇒ open", but under the Supabase wall auth
  // is very much ON — so any free Supabase account could own every org. Ownership is bootstrapped only
  // for an identity-verified viewer (personal namespace or GitHub-confirmed org admin), never lazily for
  // the first stranger to touch an ownerless org (the owner land-grab); after that, only members with a
  // sufficient role pass.
  if (authGateEnabled()) {
    const viewer = await getViewer();
    if (!viewer) {
      return NextResponse.json({ error: "Sign in to manage this organization." }, { status: 401 });
    }
    if (roleAtLeast(await viewerOrgRole(slug, viewer), min)) return null;
    return NextResponse.json(
      { error: `This action requires the ${min} role in this organization.` },
      { status: 403 },
    );
  }

  // Custom GitHub OAuth path (dormant under the Supabase wall) and fully auth-off (local/demo).
  if (!isAuthConfigured()) return null;
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
