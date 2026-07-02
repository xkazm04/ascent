// Org membership + role persistence — the data behind RBAC (Membership.role), bridged to the GitHub
// login the session actually carries (auth is GitHub-OAuth/App based, so there's no email/password
// identity). A User row is keyed by `githubLogin` (email is set to the GitHub noreply form to satisfy
// the required-unique column). Roles: owner > admin > member > viewer.
//
// Today the only writer is ensureOwnerMembership (called when an installation-owner accesses their org,
// seeding them as `owner`) and the owner-gated member admin endpoint. The resolver getMembershipRole is
// read by src/lib/authz.ts (requireOrgRole). A future invite/SSO flow populates members/viewers.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";

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
  const user = await prisma.user.findUnique({ where: { githubLogin: gh }, select: { id: true } });
  if (!user) return null;
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return null;
  const m = await prisma.membership.findUnique({
    where: { orgId_userId: { orgId, userId: user.id } },
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
  const user = await prisma.user.upsert({
    where: { githubLogin: gh },
    update: name ? { name } : {},
    create: { githubLogin: gh, email: `${gh}@users.noreply.github.com`, name: name ?? null },
    select: { id: true },
  });
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
    where: { orgId_userId: { orgId: org.id, userId: user.id } },
    update: {},
    create: { orgId: org.id, userId: user.id, role: "owner" },
  });
}

/**
 * Set (or change) a member's role — the owner-gated member admin path. Creates the user/membership if
 * absent. Returns a typed outcome (mirrors removeMembership): `last_owner` when the change would demote
 * the org's only owner (which would orphan its admin surface — refused), `error` on a bad input / unknown
 * org / DB-off, else `ok`.
 */
export async function setMembershipRole(orgSlug: string, login: string, role: OrgRole): Promise<"ok" | "last_owner" | "error"> {
  if (!isDbConfigured()) return "error";
  const prisma = getPrisma();
  const gh = normalizeLogin(login);
  if (!gh) return "error";
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return "error";
  const user = await prisma.user.upsert({
    where: { githubLogin: gh },
    update: {},
    create: { githubLogin: gh, email: `${gh}@users.noreply.github.com` },
    select: { id: true },
  });
  // Last-owner guard + the role write run in ONE transaction so two concurrent owner-gated requests
  // can't each read "2 owners > 1", both proceed, and orphan the org with zero owners (a TOCTOU the
  // separate read-then-write left open). On Aurora DSQL (serializable) the loser aborts; the count is
  // re-read inside the tx so the guard sees a consistent snapshot.
  try {
    return await prisma.$transaction(async (tx) => {
      if (role !== "owner") {
        const existing = await tx.membership.findUnique({
          where: { orgId_userId: { orgId, userId: user.id } },
          select: { role: true },
        });
        if (existing?.role === "owner") {
          const owners = await tx.membership.count({ where: { orgId, role: "owner" } });
          if (owners <= 1) return "last_owner" as const;
        }
      }
      await tx.membership.upsert({
        where: { orgId_userId: { orgId, userId: user.id } },
        update: { role },
        create: { orgId, userId: user.id, role },
      });
      return "ok" as const;
    });
  } catch {
    return "error";
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
  const user = await prisma.user.findUnique({ where: { githubLogin: gh }, select: { id: true } });
  if (!user) return "not_found";
  // Last-owner guard + delete run in ONE transaction (see setMembershipRole) so two concurrent
  // removals can't both pass the "owners > 1" check and leave the org with no owner.
  try {
    return await prisma.$transaction(async (tx) => {
      const m = await tx.membership.findUnique({
        where: { orgId_userId: { orgId, userId: user.id } },
        select: { role: true },
      });
      if (!m) return "not_found" as const;
      if (m.role === "owner") {
        const owners = await tx.membership.count({ where: { orgId, role: "owner" } });
        if (owners <= 1) return "last_owner" as const;
      }
      await tx.membership.delete({ where: { orgId_userId: { orgId, userId: user.id } } });
      return "ok" as const;
    });
  } catch {
    return "not_found";
  }
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
