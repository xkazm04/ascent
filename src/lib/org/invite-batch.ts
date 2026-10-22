// Batch invite classifier (members-1). PURE: no db, no server-only, no node: imports, so the SAME
// function runs in the browser for the instant preview (MemberInvites, against the roster and the
// pending list the page already holds) and on the server as the authority (POST /api/org/invites
// { action: "batch" }, against the rows it reads itself). The client's plan and the server's outcome
// therefore cannot drift: the server re-judges every target and has the final say.
//
// The shape regexes live here so the single-invite path and the batch path share one definition.

import type { OrgRole } from "@/lib/db/members";

/** A batch is capped so the per-invite mail path is not a bulk-send lever. */
export const INVITE_BATCH_MAX = 25;

/** GitHub logins: 1-39 chars of alphanumerics and hyphens. `@` is outside the class on purpose: an
 *  email typed as a login is refused, never stored as a pin (see the route's G2-31 note). */
export const GITHUB_LOGIN = /^[A-Za-z0-9-]{1,39}$/;
/** Minimal email shape: one @, non-empty space-free local and domain parts, a dot in the domain. */
export const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailTarget(target: string): boolean {
  return target.includes("@");
}

/** One token as the owner meant it: trimmed, a leading `@` (a GitHub mention) dropped, lower-cased.
 *  GitHub logins and email addresses both compare case-insensitively, and createInvite already
 *  lower-cases a stored login. */
export function normalizeInviteTarget(raw: string): string {
  return raw.trim().replace(/^@+/, "").toLowerCase();
}

/** Split pasted text on commas, semicolons and whitespace (newlines included). Repeats are reported
 *  separately so the preview can say what it folded. */
export function parseInviteTargets(text: string): { targets: string[]; duplicates: string[] } {
  const targets: string[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();
  for (const token of text.split(/[\s,;]+/)) {
    const t = normalizeInviteTarget(token);
    if (!t) continue;
    if (seen.has(t)) duplicates.push(t);
    else {
      seen.add(t);
      targets.push(t);
    }
  }
  return { targets, duplicates };
}

export type InvitePlanOutcome = "invite" | "already_member" | "already_pending" | "invalid" | "duplicate";

export interface InvitePlanRow {
  /** The target as given (the server answers in the caller's own spelling, in input order). */
  target: string;
  kind: "login" | "email" | null;
  outcome: InvitePlanOutcome;
  /** already_member: the role they hold today. */
  role?: OrgRole;
  /** already_pending: the live invite to resend instead of minting a second link. */
  inviteId?: string;
}

export interface RosterMember {
  login: string;
  role: OrgRole;
}
export interface PendingTarget {
  id: string;
  githubLogin?: string | null;
  email?: string | null;
}

/** Judge each target against the roster and the pending list, in input order. A second occurrence of
 *  a target is a `duplicate`, so one request can never mint two links for the same person. */
export function classifyInviteTargets(
  targets: readonly string[],
  members: readonly RosterMember[],
  pending: readonly PendingTarget[],
): InvitePlanRow[] {
  const memberRole = new Map(members.map((m) => [m.login.toLowerCase(), m.role] as const));
  const pendingByLogin = new Map<string, string>();
  const pendingByEmail = new Map<string, string>();
  for (const p of pending) {
    if (p.githubLogin) pendingByLogin.set(p.githubLogin.toLowerCase(), p.id);
    if (p.email) pendingByEmail.set(p.email.trim().toLowerCase(), p.id);
  }
  const seen = new Set<string>();
  return targets.map((target): InvitePlanRow => {
    const key = normalizeInviteTarget(target);
    const kind = EMAIL_SHAPE.test(key) ? "email" : GITHUB_LOGIN.test(key) ? "login" : null;
    if (!kind) return { target, kind: null, outcome: "invalid" };
    if (seen.has(key)) return { target, kind, outcome: "duplicate" };
    seen.add(key);
    if (kind === "login") {
      const role = memberRole.get(key);
      if (role) return { target, kind, outcome: "already_member", role };
      const inviteId = pendingByLogin.get(key);
      if (inviteId) return { target, kind, outcome: "already_pending", inviteId };
    } else {
      const inviteId = pendingByEmail.get(key);
      if (inviteId) return { target, kind, outcome: "already_pending", inviteId };
    }
    return { target, kind, outcome: "invite" };
  });
}

export type InvitePlanCounts = Record<InvitePlanOutcome, number>;

export function countInvitePlan(rows: readonly InvitePlanRow[]): InvitePlanCounts {
  const counts: InvitePlanCounts = { invite: 0, already_member: 0, already_pending: 0, invalid: 0, duplicate: 0 };
  for (const r of rows) counts[r.outcome] += 1;
  return counts;
}
