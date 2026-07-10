// Org membership + role persistence — the data behind RBAC (Membership.role), bridged to the GitHub
// login the session actually carries (auth is GitHub-OAuth/App based, so there's no email/password
// identity). A User row is keyed by `githubLogin` (email is set to the GitHub noreply form to satisfy
// the required-unique column). Roles: owner > admin > member > viewer.
//
// Today the only writer is ensureOwnerMembership (called when an installation-owner accesses their org,
// seeding them as `owner`) and the owner-gated member admin endpoint. The resolver getMembershipRole is
// read by src/lib/authz.ts (requireOrgRole). A future invite/SSO flow populates members/viewers.

import type { Prisma, PrismaClient } from "@prisma/client";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";
import { PUBLIC_ORG } from "@/lib/org-constants";

export type OrgRole = "owner" | "admin" | "member" | "viewer";

const ROLE_RANK: Record<OrgRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

/** Does `role` meet or exceed `min` in the hierarchy? Null/unknown role never qualifies. */
export function roleAtLeast(role: OrgRole | null | undefined, min: OrgRole): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export function isOrgRole(v: string): v is OrgRole {
  return v === "owner" || v === "admin" || v === "member" || v === "viewer";
}

export interface OrgMember {
  login: string;
  name: string | null;
  role: OrgRole;
  createdAt: Date;
}

function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

/** Synthetic, unique email for a GitHub-OAuth/App user (the identity carries no real email) — satisfies
 *  User.email's required-unique column. Single-sourced so the noreply domain can't drift between the
 *  two writers that mint it. */
function noreplyEmail(gh: string): string {
  return `${gh}@users.noreply.github.com`;
}

/**
 * Resolve (creating if absent) the User row id for an already-normalized GitHub login — the
 * GitHub-login→User bridge the role writers share. Stamps the synthetic noreply email on create;
 * updates the display name only when one is supplied (the lazy owner-seed passes it, the role write
 * doesn't). `name` defaults to null on create, matching the nullable, default-less User.name column.
 */
async function ensureUserId(prisma: PrismaClient, gh: string, name?: string | null): Promise<string> {
  const user = await prisma.user.upsert({
    where: { githubLogin: gh },
    update: name ? { name } : {},
    create: { githubLogin: gh, email: noreplyEmail(gh), name: name ?? null },
    select: { id: true },
  });
  return user.id;
}

/** The User row id for an already-normalized GitHub login, or null when no row exists (read-only). */
async function findUserId(prisma: PrismaClient, gh: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { githubLogin: gh }, select: { id: true } });
  return user?.id ?? null;
}

/**
 * Inside a membership transaction: is `orgId` down to a single owner, so demoting/removing one would
 * orphan its admin surface? Re-read on the SAME `tx` object as the write so the last-owner guard sees a
 * consistent snapshot (TOCTOU-safe) — the single safety-critical invariant shared by setMembershipRole
 * and removeMembership.
 */
async function isLastOwner(tx: Prisma.TransactionClient, orgId: string): Promise<boolean> {
  const owners = await tx.membership.count({ where: { orgId, role: "owner" } });
  return owners <= 1;
}

/**
 * Does `orgSlug` already have at least one owner? Used by the Supabase-login-wall role gate to decide
 * trust-on-first-use: an org with no owner yet may be claimed by the first viewer who manages it, but
 * once it has an owner, only members with a sufficient role may act (closing cross-tenant takeover).
 */
export async function orgHasOwner(orgSlug: string): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return false;
  const owners = await getPrisma().membership.count({ where: { orgId, role: "owner" } });
  return owners > 0;
}

/** The caller's role in `orgSlug`, or null when they have no membership row. */
export async function getMembershipRole(orgSlug: string, login: string): Promise<OrgRole | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const gh = normalizeLogin(login);
  if (!gh) return null;
  const userId = await findUserId(prisma, gh);
  if (!userId) return null;
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return null;
  const m = await prisma.membership.findUnique({
    where: { orgId_userId: { orgId, userId } },
    select: { role: true },
  });
  if (!m) return null;
  return isOrgRole(m.role) ? m.role : "member";
}

/**
 * Seed `login` as `owner` of `orgSlug` if they have no membership yet (idempotent; never downgrades an
 * existing role). Called lazily when an installation-owner accesses their org, so the RBAC tables stop
 * being vestigial and an admin/invite flow has a real owner to build on. Best-effort — callers ignore
 * failures (it must never block a read).
 */
export async function ensureOwnerMembership(orgSlug: string, login: string, name?: string | null): Promise<void> {
  if (!isDbConfigured()) return;
  const prisma = getPrisma();
  const gh = normalizeLogin(login);
  if (!gh || orgSlug === "public") return;
  const userId = await ensureUserId(prisma, gh, name);
  const org = await prisma.organization.upsert({
    where: { slug: orgSlug },
    update: {},
    // Set `plan` to the canonical schema default ("free"; see prisma Organization.plan @default) rather
    // than leaving it implicit. The owner-seed path used to create a plan-less org, so whether the watch
    // path or this one won the create race decided the org's effective plan (retentionCutoff reads it) —
    // pin it here so first-touch is deterministic and a future schema-default change can't silently
    // repoint new orgs. (org-watch's ensureOrg still uses a legacy "private" string, which planFeatures
    // also resolves to the free tier — reconciling that outlier + backfilling old rows is out of scope.)
    create: { slug: orgSlug, name: orgSlug, plan: "free" },
    select: { id: true },
  });
  await prisma.membership.upsert({
    where: { orgId_userId: { orgId: org.id, userId } },
    update: {},
    create: { orgId: org.id, userId, role: "owner" },
  });
}

/**
 * Set (or change) a member's role — the owner-gated member admin path. Creates the user/membership if
 * absent. Returns a typed outcome (mirrors removeMembership): `last_owner` when the change would demote
 * the org's only owner (which would orphan its admin surface — refused), `error` on a bad input / unknown
 * org / DB-off, `db_error` when the role-write transaction itself throws (transient infra failure, NOT a
 * missing org), else `ok`. The two failure modes are kept distinct so the route can map a real
 * unknown-org to 404 and a transient write failure to 503 instead of a misleading "Unknown organization".
 */
export async function setMembershipRole(orgSlug: string, login: string, role: OrgRole): Promise<"ok" | "last_owner" | "error" | "db_error"> {
  if (!isDbConfigured()) return "error";
  const prisma = getPrisma();
  const gh = normalizeLogin(login);
  if (!gh) return "error";
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return "error";
  const userId = await ensureUserId(prisma, gh);
  // Last-owner guard + the role write run in ONE transaction so two concurrent owner-gated requests
  // can't each read "2 owners > 1", both proceed, and orphan the org with zero owners (a TOCTOU the
  // separate read-then-write left open).
  //
  // members-access-control #5: a bare $transaction alone does NOT close this. The two requests demote
  // DIFFERENT owner rows (A vs B), so there is no write-write conflict; under a vanilla Postgres
  // deployment's default READ COMMITTED, each tx's `count(role:"owner")` is a SNAPSHOT read that neither
  // blocks on nor sees the other's uncommitted write, so BOTH read 2 (>1), both commit, and the org is
  // orphaned. A correlated conditional write (`... WHERE (SELECT count(*) owners) > 1`) is NO better —
  // that subquery is the same non-locking snapshot read. The only portable fix (works on both Aurora DSQL
  // and stock Postgres) with NO schema change is to run the guard at SERIALIZABLE isolation: the count
  // read then participates in the serialization graph, so on stock Postgres SSI aborts one of the two
  // concurrent demotions (40001) and on DSQL the OCC commit loses — the invariant "owner count never
  // reaches 0" now holds. A serialization abort surfaces below as a transient failure (db_error → 503
  // retry on the loser), never a silent orphan. The count is re-read inside the tx so the guard reads a
  // consistent snapshot.
  try {
    return await prisma.$transaction(async (tx) => {
      if (role !== "owner") {
        const existing = await tx.membership.findUnique({
          where: { orgId_userId: { orgId, userId } },
          select: { role: true },
        });
        if (existing?.role === "owner" && (await isLastOwner(tx, orgId))) return "last_owner" as const;
      }
      await tx.membership.upsert({
        where: { orgId_userId: { orgId, userId } },
        update: { role },
        create: { orgId, userId, role },
      });
      return "ok" as const;
    }, { isolationLevel: "Serializable" });
  } catch {
    // The org exists (orgId resolved above); this is the transaction failing transiently
    // (serialization abort / DB blip). Signal it distinctly so the caller doesn't report 404.
    return "db_error";
  }
}

/**
 * Remove a member entirely (owner-gated). Refuses to remove the LAST owner so an org can't be
 * orphaned with no one able to manage it. Returns a typed outcome the route maps to a status.
 */
export async function removeMembership(orgSlug: string, login: string): Promise<"ok" | "not_found" | "last_owner"> {
  if (!isDbConfigured()) return "not_found";
  const prisma = getPrisma();
  const gh = normalizeLogin(login);
  const orgId = await getOrgId(orgSlug);
  if (!gh || !orgId) return "not_found";
  const userId = (await prisma.user.findUnique({ where: { githubLogin: gh }, select: { id: true } }))?.id;
  if (!userId) return "not_found";
  // Last-owner guard + delete run in ONE SERIALIZABLE transaction (see setMembershipRole for the full
  // rationale — a plain read-committed tx leaves the two-distinct-owner TOCTOU open; serializable makes
  // the count read conflict on both stock Postgres (SSI) and Aurora DSQL (OCC) so the two concurrent
  // removals can't both pass the "owners > 1" check and leave the org with no owner).
  try {
    return await prisma.$transaction(async (tx) => {
      const m = await tx.membership.findUnique({
        where: { orgId_userId: { orgId, userId } },
        select: { role: true },
      });
      if (!m) return "not_found" as const;
      if (m.role === "owner" && (await isLastOwner(tx, orgId))) return "last_owner" as const;
      await tx.membership.delete({ where: { orgId_userId: { orgId, userId } } });
      return "ok" as const;
    }, { isolationLevel: "Serializable" });
  } catch {
    // A serialization abort (the loser of two concurrent owner removals) lands here too. removeMembership's
    // outcome type has no db_error variant, so it maps to not_found — safe (the removal simply didn't
    // happen; the org keeps its owner), just a benign retry for the caller. The invariant is preserved.
    return "not_found";
  }
}

/** A real (non-public) org the viewer belongs to, for the header's "enter your org" affordance. */
export interface ViewerOrg {
  slug: string;
  name: string;
  role: OrgRole;
}

/**
 * The real orgs `login` is a member of — the signal the header uses to swap the generic "Org demo"
 * link for a direct "enter your org" one. Excludes the shared PUBLIC_ORG (never a tenant the viewer
 * "owns"). Ordered most-privileged first, then most-recently-joined, so `[0]` is the natural primary
 * org to surface. Empty when the login has no membership rows (signed in but no org created yet) — the
 * caller then keeps the demo link. Keyed on githubLogin, the identity both the OAuth session and the
 * Supabase/dev viewer carry (same bridge getMembershipRole uses).
 */
export async function listOrgsForLogin(login: string): Promise<ViewerOrg[]> {
  if (!isDbConfigured()) return [];
  const gh = normalizeLogin(login);
  if (!gh) return [];
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({ where: { githubLogin: gh }, select: { id: true } });
  if (!user) return [];
  const rows = await prisma.membership.findMany({
    where: { userId: user.id },
    select: { role: true, createdAt: true, org: { select: { slug: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return rows
    .filter((r) => r.org && r.org.slug !== PUBLIC_ORG)
    .map((r) => ({ slug: r.org.slug, name: r.org.name, role: isOrgRole(r.role) ? r.role : "member" }))
    .sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role]);
}

/** All members of an org (owner-gated view). */
export async function listOrgMembers(orgSlug: string): Promise<OrgMember[]> {
  if (!isDbConfigured()) return [];
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return [];
  const rows = await prisma.membership.findMany({
    where: { orgId },
    select: { role: true, createdAt: true, user: { select: { githubLogin: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    login: r.user.githubLogin ?? "(unknown)",
    name: r.user.name ?? null,
    role: isOrgRole(r.role) ? r.role : "member",
    createdAt: r.createdAt,
  }));
}
