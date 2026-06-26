// Org invitations (MEM-2) — the missing "add a teammate" path. Before this, the only way to grant a
// role was an owner typing an exact GitHub login into setMembershipRole (a typo created a ghost
// membership). An invite carries a single-use token (the capability in the /invite/[token] link),
// optionally pins a githubLogin, expires after 7 days, and is consumed by acceptInvite →
// setMembershipRole. Owner-gated at the route; storage + the accept transition live here.
// No-op-safe without a DB, like the rest of the db layer.

import { randomBytes } from "node:crypto";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { isOrgRole, setMembershipRole, type OrgRole } from "@/lib/db/members";
import { getOrgId } from "@/lib/db/org-rollup";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface PendingInvite {
  id: string;
  email: string | null;
  githubLogin: string | null;
  role: OrgRole;
  token: string;
  invitedBy: string | null;
  createdAt: string;
  expiresAt: string;
}

/** Create a pending invite. Returns the row (with its token) or null (DB-less / unknown org). */
export async function createInvite(
  orgSlug: string,
  input: { role: OrgRole; email?: string | null; githubLogin?: string | null; invitedBy?: string | null },
): Promise<PendingInvite | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return null;
  const token = randomBytes(24).toString("base64url");
  const row = await prisma.invite.create({
    data: {
      orgId,
      role: input.role,
      email: input.email?.trim() || null,
      githubLogin: input.githubLogin?.trim().toLowerCase() || null,
      token,
      invitedBy: input.invitedBy ?? null,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
  });
  return toPending(row);
}

/** A pending invite WITHOUT its token — the safe shape for listings (the token is the capability). */
export type PendingInviteSummary = Omit<PendingInvite, "token">;

/**
 * Pending (un-accepted, un-revoked, un-expired) invites for an org — owner view. The raw `token` is
 * deliberately OMITTED: it is the capability that protects the accept flow, so it must be shown once
 * (the POST create response) and never re-broadcast on every owner page load / RSC payload / proxy
 * log. Owners copy the link at creation; to re-share, revoke and re-issue.
 */
export async function listPendingInvites(orgSlug: string): Promise<PendingInviteSummary[]> {
  if (!isDbConfigured()) return [];
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return [];
  const rows = await getPrisma().invite.findMany({
    where: { orgId, status: "pending", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => {
    const { token: _token, ...summary } = toPending(r);
    return summary;
  });
}

export type InvitePeek =
  | { ok: true; org: string; role: OrgRole; pinnedLogin: string | null }
  | { ok: false; reason: "not_found" | "expired" | "used" };

/**
 * READ-ONLY preview of an invite for the accept page — validates pending + unexpired and returns the
 * org/role (and any pinned login) WITHOUT consuming it. The actual grant happens only via the
 * same-origin POST accept route + acceptInvite, so rendering this page (a GET, which prefetchers /
 * link unfurlers / URL scanners trigger) no longer mutates state or burns the invite.
 */
export async function peekInvite(token: string): Promise<InvitePeek> {
  if (!isDbConfigured()) return { ok: false, reason: "not_found" };
  const invite = await getPrisma().invite.findUnique({
    where: { token },
    select: { status: true, expiresAt: true, role: true, githubLogin: true, org: { select: { slug: true } } },
  });
  if (!invite) return { ok: false, reason: "not_found" };
  if (invite.status !== "pending") return { ok: false, reason: "used" };
  if (invite.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };
  return {
    ok: true,
    org: invite.org.slug,
    role: isOrgRole(invite.role) ? invite.role : "member",
    pinnedLogin: invite.githubLogin,
  };
}

/** Revoke a pending invite (owner action). Scoped to the org so an id from another tenant can't be hit. */
export async function revokeInvite(orgSlug: string, id: string): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return false;
  const res = await getPrisma().invite.updateMany({
    where: { id, orgId, status: "pending" },
    data: { status: "revoked" },
  });
  return res.count > 0;
}

export type AcceptResult =
  | { ok: true; org: string; role: OrgRole }
  | { ok: false; reason: "not_found" | "expired" | "used" | "wrong_user" | "db" };

/** Identity of the viewer accepting an invite — their GitHub login plus, under the Supabase wall, the
 *  verified email used to bind an EMAIL-pinned invite. */
export interface AcceptIdentity {
  login: string;
  email?: string | null;
}

/**
 * Accept an invite by token for the signed-in viewer. Validates pending + unexpired, BINDS the grant to
 * the invited identity, grants the role via setMembershipRole, and marks the invite accepted.
 *
 * Binding: a githubLogin-pinned invite must match the viewer's login. An EMAIL-only invite (no login
 * pinned) must match the viewer's VERIFIED email — without this the token ALONE (forwarded, or leaked
 * from an inbox / mail gateway / log) would hand the role to whoever opened the link, even though the
 * owner's pending-invite list shows it bound to that address. An invite carrying NEITHER stays open to
 * any signed-in viewer (the owner deliberately left it unpinned).
 */
export async function acceptInvite(token: string, identity: AcceptIdentity): Promise<AcceptResult> {
  if (!isDbConfigured()) return { ok: false, reason: "db" };
  const prisma = getPrisma();
  const gh = identity.login.trim().toLowerCase();
  const viewerEmail = identity.email?.trim().toLowerCase() || null;
  const invite = await prisma.invite.findUnique({
    where: { token },
    select: { id: true, status: true, expiresAt: true, role: true, githubLogin: true, email: true, org: { select: { slug: true } } },
  });
  if (!invite) return { ok: false, reason: "not_found" };
  if (invite.status !== "pending") return { ok: false, reason: "used" };
  if (invite.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };
  if (invite.githubLogin) {
    if (invite.githubLogin !== gh) return { ok: false, reason: "wrong_user" };
  } else if (invite.email) {
    // Email-pinned, no login: require the accepter's verified email to match (case-insensitively). A
    // viewer with no verified email (e.g. the dormant custom-OAuth session) can't claim it — fail closed.
    if (!viewerEmail || invite.email.trim().toLowerCase() !== viewerEmail) return { ok: false, reason: "wrong_user" };
  }

  const role: OrgRole = isOrgRole(invite.role) ? invite.role : "member";
  // Claim-first: atomically flip the row pending→accepted keyed on BOTH id AND status, BEFORE granting.
  // The three-step accept (read pending → grant → flip) was not atomic and the final update keyed on id
  // alone, so two viewers racing to accept the SAME unpinned invite (a deliberately common case: an
  // open link dropped in a channel) both read "pending", both granted a membership (to two different
  // accounts), and both flipped to accepted — a single-use capability redeemed twice. The conditional
  // updateMany serializes that race: exactly one caller matches the still-pending row (count === 1) and
  // proceeds; the loser sees count 0 and gets `used`, making a double grant impossible.
  const claim = await prisma.invite.updateMany({
    where: { id: invite.id, status: "pending" },
    data: { status: "accepted" },
  });
  if (claim.count !== 1) return { ok: false, reason: "used" };

  const granted = await setMembershipRole(invite.org.slug, gh, role);
  if (granted !== "ok") {
    // The grant failed AFTER we claimed the invite. Release the claim (pending again) so the invite
    // stays re-usable — preserving the prior "a failed grant leaves the invite re-usable" guarantee.
    await prisma.invite
      .updateMany({ where: { id: invite.id, status: "accepted" }, data: { status: "pending" } })
      .catch(() => {});
    return { ok: false, reason: "db" };
  }
  return { ok: true, org: invite.org.slug, role };
}

function toPending(r: {
  id: string;
  email: string | null;
  githubLogin: string | null;
  role: string;
  token: string;
  invitedBy: string | null;
  createdAt: Date;
  expiresAt: Date;
}): PendingInvite {
  return {
    id: r.id,
    email: r.email,
    githubLogin: r.githubLogin,
    role: isOrgRole(r.role) ? r.role : "member",
    token: r.token,
    invitedBy: r.invitedBy,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
  };
}
