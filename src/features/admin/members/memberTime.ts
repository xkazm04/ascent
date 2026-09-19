// How the Members tab renders a moment. Two of them: when a member joined (past) and when an invite
// lapses (future).
//
// The house policy — registry software-engineering/status-vocabulary, technique `timestamp-display`
// — is RELATIVE BY DEFAULT, ABSOLUTE ONE HOVER AWAY, with the locale bound inside the renderer rather
// than taken from the host machine by a bare `toLocaleDateString()` at the call site. The past half
// already has a house primitive that seventeen surfaces use (`timeAgo`, src/lib/ui.ts); the FUTURE
// half had none, so this module supplies it and both call sites here go through one of the two.
//
// WHY THIS ISN'T src/lib/email/invite.ts's `daysUntil`, which computes the same quantity for the
// invite mail's "expires in N days" line: that module imports ./index, which constructs the SES and
// Resend clients — importing it from a client component would drag both SDKs into the browser
// bundle. So the two stay separate deliberately, and this comment is the link between them. If a
// shared future-moment primitive ever lands in src/lib/ui.ts beside timeAgo, both should collapse
// into it.

/** Absolute rendering for the hover title — the precise moment behind a relative label. */
export function absoluteMoment(iso: string): string {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? "unknown" : t.toLocaleString();
}

/**
 * How long until `iso`, as the phrase that goes beside a pending invite. The invite mail says
 * "expires in 3 days"; this is the same sentence for the owner's own list, which said `9/13/2026`
 * and left them to subtract dates to find the one about to lapse.
 *
 * `nowMs` DEFAULTS to the clock and is injectable so the bands stay pinned by tests — the same shape
 * `timeAgo` (src/lib/ui.ts) uses, and the reason the call sites can stay pure: React's purity rule
 * forbids `Date.now()` in a component body, so the clock read belongs inside the renderer. (This is
 * the clock, not the locale: the registry's warning about a defaulted parameter is about locale
 * arguments, whose default is the bug. A defaulted clock is the primitive owning "now".)
 *
 * Days are counted the way the mail counts them (rounded whole days from now), so the two surfaces
 * describing one deadline cannot disagree by a day.
 */
export function expiresIn(iso: string, nowMs: number = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "expiry unknown";
  const days = Math.round((t - nowMs) / 86_400_000);
  if (t <= nowMs) return "expired";
  if (days <= 0) return "expires today";
  if (days === 1) return "expires tomorrow";
  return `expires in ${days} days`;
}
