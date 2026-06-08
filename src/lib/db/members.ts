// Org membership + role persistence — the data behind RBAC (Membership.role), bridged to the GitHub
// login the session actually carries (auth is GitHub-OAuth/App based, so there's no email/password
// identity). A User row is keyed by `githubLogin` (email is set to the GitHub noreply form to satisfy
// the required-unique column). Roles: owner > admin > member > viewer.
//
// Today the only writer is ensureOwnerMembership (called when an installation-owner accesses their org,
// seeding them as `owner`) and the owner-gated member admin endpoint. The resolver getMembershipRole is
// read by src/lib/authz.ts (requireOrgRole). A future invite/SSO flow populates members/viewers.

import { getPrisma, isDbConfigured } from "@/lib/db/client";

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

async function orgIdForSlug(slug: string): Promise<string | null> {
  const org = await getPrisma().organization.findUnique({ where: { slug }, select: { id: true } });
  return org?.id ?? null;
}

/** The caller's role in `orgSlug`, or null when they have no membership row. */
export async function getMembershipRole(orgSlug: string, login: string): Promise<OrgRole | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const gh = normalizeLogin(login);
  if (!gh) return null;
  const user = await prisma.user.findUnique({ where: { githubLogin: gh }, select: { id: true } });
  if (!user) return null;
  const orgId = await orgIdForSlug(orgSlug);
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
    create: { slug: orgSlug, name: orgSlug },
    select: { id: true },
  });
  await prisma.membership.upsert({
    where: { orgId_userId: { orgId: org.id, userId: user.id } },
    update: {},
    create: { orgId: org.id, userId: user.id, role: "owner" },
  });
}

/** Set (or change) a member's role — the owner-gated member admin path. Creates the user/membership if absent. */
export async function setMembershipRole(orgSlug: string, login: string, role: OrgRole): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const prisma = getPrisma();
  const gh = normalizeLogin(login);
  if (!gh) return false;
  const user = await prisma.user.upsert({
    where: { githubLogin: gh },
    update: {},
    create: { githubLogin: gh, email: `${gh}@users.noreply.github.com` },
    select: { id: true },
  });
  const orgId = await orgIdForSlug(orgSlug);
  if (!orgId) return false;
  await prisma.membership.upsert({
    where: { orgId_userId: { orgId, userId: user.id } },
    update: { role },
    create: { orgId, userId: user.id, role },
  });
  return true;
}

/** All members of an org (owner-gated view). */
export async function listOrgMembers(orgSlug: string): Promise<OrgMember[]> {
  if (!isDbConfigured()) return [];
  const prisma = getPrisma();
  const orgId = await orgIdForSlug(orgSlug);
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
