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
    create: { slug: orgSlug, name: orgSlug },
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
 * org / DB-off, else `ok`.
 */
export async function setMembershipRole(orgSlug: string, login: string, role: OrgRole): Promise<"ok" | "last_owner" | "error"> {
  if (!isDbConfigured()) return "error";
  const prisma = getPrisma();
  const gh = normalizeLogin(login);
  if (!gh) return "error";
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return "error";
  const userId = await ensureUserId(prisma, gh);
  // Last-owner guard + the role write run in ONE transaction so two concurrent owner-gated requests
  // can't each read "2 owners > 1", both proceed, and orphan the org with zero owners (a TOCTOU the
  // separate read-then-write left open). On Aurora DSQL (serializable) the loser aborts; isLastOwner
  // re-reads the count inside the tx so the guard sees a consistent snapshot.
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
  const userId = await findUserId(prisma, gh);
  if (!userId) return "not_found";
  // Last-owner guard + delete run in ONE transaction (see setMembershipRole) so two concurrent
  // removals can't both pass the "owners > 1" check and leave the org with no owner.
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
