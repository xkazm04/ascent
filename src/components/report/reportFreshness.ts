// Freshness as a STATE with a reason, not one muted relative-time string.
//
// `freshness()` (src/lib/ui.ts) is a pure relative-time formatter: a reading taken ten minutes ago
// and one taken seven months ago render in the same muted slate, and neither says that the repo has
// moved off the commit that was scored. The scan pipeline, meanwhile, holds a precise opinion about
// when a reading stops counting: `scanMaxCacheAgeMs()` (src/lib/scan-cache.ts) declares the belief
// window and the persisted-cache tier refuses to serve a report past it as current. The permalink
// serves such a report anyway (it is the pinned artifact), so the surface that PUBLISHES the claim
// has to state what the claim is about. Four tiers, every one of which renders; none wears the
// fresh costume.
//
// WHY THE WINDOW IS AN INPUT, NOT AN IMPORT. `scanMaxCacheAgeMs()` lives in `@/lib/scan-cache`,
// which reaches `@/lib/db` and `@/lib/github/source`, and importing it here would drag the DB client
// into the client bundle through `FreshnessControl` ("use client"). The server reads the window and
// threads it down as one number instead, so the threshold is still read from the pipeline's own
// declaration (one knob moves both) and this module stays pure and client-safe.
//
// WHY DRIFT IS WORDED "LAST SEEN". `Repository.headSha` is a durably REMEMBERED hint, refreshed by
// whichever path last looked, not a live lookup. Claiming it as the repo's current head would be a
// claim this data cannot support, so the copy says "last seen head" and the clause is suppressed
// entirely when no hint was ever recorded.

/** Four states, and no state is allowed to render as another. */
export type ReportFreshnessTier = "current" | "aging" | "stale" | "unknown";

export type ReportFreshnessState = {
  tier: ReportFreshnessTier;
  /** Milliseconds since the scan, or null when the timestamp could not be read. */
  ageMs: number | null;
  /** The belief window the caller was handed, or null when nobody threaded one. */
  windowMs: number | null;
  drifted: boolean;
  /** Abbreviated shas, ready to render. Null when absent. */
  scoredSha: string | null;
  lastSeenHead: string | null;
  /** One sentence naming why this tier. Empty for `current`, which states nothing extra. */
  reason: string;
  /** One sentence for the drift clause. Empty when not drifted. */
  driftNote: string;
};

/** A renderable 7-char abbreviation, or null for absent/blank input. */
export function shortSha(sha?: string | null): string | null {
  const trimmed = (sha ?? "").trim();
  return trimmed ? trimmed.slice(0, 7) : null;
}

/** The belief window in the words a reader uses: "7-day", "1-day", "6-hour". */
export function freshnessWindowLabel(windowMs: number): string {
  const days = windowMs / 86_400_000;
  if (Number.isInteger(days) && days >= 1) return `${days}-day`;
  return `${Math.round(windowMs / 3_600_000)}-hour`;
}

const NO_DATE_REASON =
  "This reading has no recorded scan date, so its age cannot be stated. Re-test for a dated one.";

/**
 * Derive the freshness state of a reading. Total over null, absent and garbled input: an
 * unreadable date is `unknown` with a stated reason, never a silent `current`.
 *
 * @param windowMs the pipeline's belief window (`scanMaxCacheAgeMs()`), read server-side. Absent
 *   (the live-scan path, which has no server pass) or `0` (the age gate disabled) means no tiering
 *   claim can be made, so a readable date stays `current` and renders exactly today's single line.
 */
export function reportFreshnessState({
  scannedAt,
  scoredSha,
  lastSeenHead,
  windowMs,
  now = Date.now(),
}: {
  scannedAt?: string | null;
  scoredSha?: string | null;
  lastSeenHead?: string | null;
  windowMs?: number | null;
  now?: number;
}): ReportFreshnessState {
  const scored = shortSha(scoredSha);
  const seen = shortSha(lastSeenHead);
  // Compare on the abbreviation so a full `Repository.headSha` against an abbreviated `Scan.headSha`
  // (or either stored in a different case) is a match, not a fabricated drift claim.
  const drifted = Boolean(scored && seen && scored.toLowerCase() !== seen.toLowerCase());
  const driftNote = drifted
    ? "The head last seen for this repository has moved since this reading was scored, so the scores describe the earlier commit."
    : "";

  const parsed = scannedAt ? new Date(scannedAt).getTime() : NaN;
  // A clock skew between the scanning instance and this one must not read as a negative age.
  const ageMs = Number.isFinite(parsed) ? Math.max(0, now - parsed) : null;
  const window = typeof windowMs === "number" && Number.isFinite(windowMs) ? windowMs : null;
  const base = { ageMs, windowMs: window, drifted, scoredSha: scored, lastSeenHead: seen, driftNote };

  if (ageMs === null) return { ...base, tier: "unknown", reason: NO_DATE_REASON };
  if (window === null || window <= 0) return { ...base, tier: "current", reason: "" };

  const label = freshnessWindowLabel(window);
  if (ageMs > window) {
    return {
      ...base,
      tier: "stale",
      reason: `This reading is older than the ${label} window this product re-scans on, so it may no longer describe the repository as it is now.`,
    };
  }
  if (ageMs > window / 2) {
    return {
      ...base,
      tier: "aging",
      reason: `This reading is past half of the ${label} window this product re-scans on, so a re-test is due soon.`,
    };
  }
  return { ...base, tier: "current", reason: "" };
}
