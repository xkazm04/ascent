// G7-02 — the invite mail. `POST /api/org/invites` created a row, returned the token, and told the
// invitee NOTHING: an email-pinned invite was a link the owner had to copy out of the UI and deliver by
// hand. This module is the missing delivery step, and nothing more.
//
// WHAT IT DISCLOSES, AND WHY THAT'S THE WHOLE DESIGN. The recipient address is supplied by an org
// admin and is, by construction, NOT verified — the org can type any address. So this mail is written
// as if it will land in a stranger's inbox:
//   - it names the org slug, the role, and (when known) the inviting login — the minimum needed to
//     decide whether to accept — and NO fleet data, scores, repo names, or member list;
//   - the token in the link is a capability that grants nothing on its own: acceptInvite still
//     requires the accepter's Supabase-CONFIRMED email to match an email-pinned invite (see
//     src/lib/db/invites.ts), so a misdirected mail cannot hand a stranger the role;
//   - it states plainly that ignoring it is safe and that no further mail will follow.
//
// CONSENT MODEL: one transactional message per invite, triggered by an explicit admin action naming
// this address. There is no list and no repeat send, so there is nothing to unsubscribe FROM — the
// opt-out is the `notify: false` field on the create call, and the whole path is inert unless the
// deploy has a provider (SES_FROM_EMAIL) and has not set EMAIL_INVITES=off.

import { dispatchBuiltEmail, type EmailDispatchResult } from "./index";
import { emailShell, paragraph } from "./render";

export interface InviteEmailInput {
  /** Org slug the invite is for. */
  org: string;
  /** Role the invite grants (never "owner" — the route refuses that). */
  role: string;
  /** Absolute `/invite/[token]` link, or null when no public base URL is configured. */
  url: string | null;
  /** GitHub login of the inviting owner, when resolvable. */
  invitedBy?: string | null;
  /** ISO expiry, used for the "expires in N days" line. */
  expiresAt?: string | null;
  /** "Now" for the expiry phrasing — injected so the builder stays pure. */
  nowMs?: number;
}

/** Whole days from `nowMs` to `expiresAt`, floored at 0; null when unknown. Pure. */
function daysUntil(expiresAt: string | null | undefined, nowMs: number | undefined): number | null {
  if (!expiresAt || nowMs == null) return null;
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((t - nowMs) / 86_400_000));
}

/**
 * Build the invite email. PURE (no env, no Date, no I/O) — same discipline as the alert builders, so
 * the exact bytes a stranger receives are pinned by unit tests.
 */
export function buildInviteEmail(input: InviteEmailInput): { subject: string; html: string; text: string } {
  const { org, role, url, invitedBy } = input;
  const by = invitedBy?.trim() ? `@${invitedBy.trim()}` : "An owner";
  const days = daysUntil(input.expiresAt, input.nowMs);
  const expiry = days == null ? null : days <= 0 ? "This invitation expires today." : `This invitation expires in ${days} day${days === 1 ? "" : "s"}.`;
  const subject = `${by === "An owner" ? "You've been invited" : `${by} invited you`} to the ${org} organization on Ascent`;

  const lead = `${by} invited you to join the "${org}" organization on Ascent as a ${role}.`;
  const what = "Ascent scores how AI-native a codebase is and tracks that maturity across a fleet of repositories.";
  const noLink = "Ask the person who invited you for the invitation link — this deployment has no public URL configured, so one couldn't be included.";
  const safeToIgnore =
    "If you weren't expecting this, you can ignore this message — nothing has been created for you and no further email will be sent to this address.";

  const text = [
    lead,
    "",
    what,
    "",
    url ? `Accept the invitation:\n${url}` : noLink,
    expiry ? `\n${expiry}` : "",
    "",
    "Accepting requires signing in with GitHub, and this invitation is bound to this email address.",
    "",
    safeToIgnore,
  ]
    .filter((l) => l !== "")
    .join("\n");

  const html = emailShell({
    heading: "You've been invited to Ascent",
    bodyHtml: [paragraph(lead), paragraph(what), url ? "" : paragraph(noLink), expiry ? paragraph(expiry) : ""].join(""),
    cta: url ? { href: url, label: "Accept the invitation →" } : null,
    showRawUrl: true,
    footer: `You received this because an owner of "${org}" on Ascent entered this address when creating an invitation. ${safeToIgnore}`,
  });

  return { subject, html, text };
}

/**
 * Is the invite mail enabled on this deploy? Off unless a provider is configured (the shared
 * getEmailSender selection decides that), and killable independently with EMAIL_INVITES=off so an
 * operator who wired SES for scan-completion mail can refuse to let invites use it.
 */
export function inviteEmailEnabled(): boolean {
  return (process.env.EMAIL_INVITES ?? "").trim().toLowerCase() !== "off";
}

/**
 * Best-effort send of an invite mail. NEVER throws and never blocks the invite itself — an invite that
 * was created is valid whether or not the mail got out, and the route still returns the token so the
 * owner can always deliver the link by hand.
 */
export async function dispatchInviteEmail(to: string, input: InviteEmailInput): Promise<EmailDispatchResult> {
  if (!inviteEmailEnabled()) return { ok: true, skipped: true };
  return dispatchBuiltEmail(to, buildInviteEmail(input));
}
