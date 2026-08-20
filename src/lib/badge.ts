// Shared, dependency-light badge contract — importable by both the server badge route and the
// "use client" BadgeGenerator (no React / server-only deps). Single-sources the two things those two
// files had each re-declared: the report click-through URL (the `?ref=badge` analytics tag) and the
// set of valid badge styles. Keeping them here means a rename (e.g. `?ref=readme-badge`, or a fourth
// style) lands in one place instead of silently desyncing the emitter, the endpoint, and the UI.

/** The "badge → report" attribution permalink. `?ref=badge` tags the click-through so a README hit is
 *  attributable in analytics / server logs (USE-1, the acquisition loop). */
export function badgeReportHref(origin: string, owner: string, repo: string): string {
  return `${origin}/report/${owner}/${repo}?ref=badge`;
}

/** The shields.io-style badge style vocabulary. The badge route's `parseStyle` narrows against this
 *  list and the generator surfaces it as the style chooser, so the two can't offer/accept different sets. */
export type BadgeStyle = "flat" | "flat-square" | "for-the-badge";
export const BADGE_STYLES: BadgeStyle[] = ["flat", "flat-square", "for-the-badge"];

// ---- rubric pinning (the embed snippet's meaning contract) ------------------
//
// A badge is a THIRD PARTY'S VERDICT about someone, pasted into their own public README, and it is
// seen far more often than the report behind it — by readers who will never click through. So the
// snippet must pin the parameters that decide what the badge MEANS, exactly as it already pins the
// gate's `min_level` (an unpinned bar is "a bar the badge author never saw or chose, which silently
// changes"). The rubric behind a LEVEL or SCORE badge is the same kind of parameter: SCORING_RUBRIC_VERSION
// has already moved r6→r7 (weights and detectors both changed), and each revision changes what "L3"
// or "63/100" asserts. Unpinned, the pasted badge silently re-states a claim under the new rubric
// that the owner never made and is never told about.
//
// THE TRADE-OFF, stated honestly. Two failures are available and we must pick one:
//   - FREEZE the value at the pinned rubric: the badge stays what the owner pasted, but it asserts an
//     old rubric's verdict forever — stale but honest.
//   - RENDER the current value with no pin: always fresh, but it restates a claim the owner never
//     made — fresh but FALSE, and invisible to both the owner and the reader.
// We take neither in its pure form. The badge keeps rendering the CURRENT verdict (freezing would
// require storing per-rubric scores this endpoint has no access to, and a permanently stale README
// badge is its own dishonesty), and the staleness is DISCLOSED in the badge itself. Following the
// repo's existing qualifier rule (G5-29: `· demo` must live in the badge VALUE, not only the label,
// because a cropped badge or a screenshot keeps only the value chip), the disclosure goes in the
// value: `L3 Established · rubric r7→r8`. A reader who sees only the value chip still learns the bar
// moved under it, and the click-through report says what changed.

/** Query param carrying the rubric version the snippet was generated under (see `rubricQualifier`). */
export const BADGE_RUBRIC_PARAM = "rubric";

// SCORING_RUBRIC_VERSION's grammar: "r" + a small integer (r1..r7 so far). Deliberately NARROW: this
// value arrives on an unauthenticated, publicly-embeddable endpoint and is rendered into SVG text, and
// a narrow accept-set also keeps the number of distinct CACHEABLE badge URLs tiny (see the route's
// `customized` note). Anything else is not a pin — it is junk, and is treated as a caller customization
// rather than silently rendered.
const RUBRIC_RE = /^r\d{1,3}$/;

/**
 * How a snippet's rubric pin relates to the rubric the server is scoring with right now.
 * - `unpinned`    — no pin (a hand-written URL, or a snippet copied before pinning existed).
 * - `current`     — pinned to the live rubric: the badge means exactly what its author pasted.
 * - `superseded`  — pinned to an older rubric: the verdict shown is under a DIFFERENT bar than the
 *                   author chose, and must say so.
 * - `malformed`   — not a rubric id at all; never rendered, never trusted.
 */
export type RubricPinState = "unpinned" | "current" | "superseded" | "malformed";

export function rubricPinState(raw: string | null | undefined, current: string): RubricPinState {
  if (raw == null || raw === "") return "unpinned";
  if (!RUBRIC_RE.test(raw)) return "malformed";
  return raw === current ? "current" : "superseded";
}

/**
 * The value-side staleness qualifier for a pinned badge, in the `· demo` idiom (G5-29). Empty for
 * every state but `superseded` — a badge pinned to the live rubric renders BYTE-IDENTICALLY to the
 * un-pinned canonical badge, which is what lets the route keep it shared-cacheable and countable.
 */
export function rubricQualifier(raw: string | null | undefined, current: string): string {
  return rubricPinState(raw, current) === "superseded" ? ` · rubric ${raw}→${current}` : "";
}

// GitHub's name grammar (owner or repo segment): [A-Za-z0-9._-], never starting with a dot, and never
// containing two consecutive dots. Single-sourced here (G5-28) so the client (`BadgeGenerator`'s
// `parseRepo`) and the server (`/api/badge/[owner]/[repo]`'s `validName`) can't drift — before this,
// the client regex was a strict-subset check that didn't reject leading/consecutive dots, so a name
// like `owner/.git` passed client validation and produced a snippet the server always rendered as
// "unknown". The server additionally enforces per-segment length caps (39 for owner, 100 for repo) —
// that cap is deliberately NOT duplicated here since the client never needs to reject on length alone
// before the request round-trips; `validName` in route.ts layers `maxLen` on top of this same regex.
const NAME_RE = /^[A-Za-z0-9_.-]+$/;
export function validRepoNamePart(s: string): boolean {
  return Boolean(s) && NAME_RE.test(s) && !s.startsWith(".") && !s.includes("..");
}
