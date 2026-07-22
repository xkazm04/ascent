// Named PR-signal thresholds shared by the analyzer and the report UI, so the presentation layer
// can't silently drift from what the analyzer actually measures. Kept in this tiny standalone
// module (not pulls.ts) because the report panel is bundled client-side via ContributorsPanel,
// and pulls.ts drags in the server-only GitHub GraphQL client.

/**
 * A "small PR" is one with ≤ this many changed lines (additions + deletions). ~200 lines is the
 * common review-ergonomics ceiling (beyond it review quality measurably drops); the analyzer counts
 * `smallPrRate` against it and the scoring prompt/UI copy must quote the same number.
 */
export const SMALL_PR_MAX_LINES = 200;

/**
 * Revert rate (%) above which the report flags reverts as "elevated". The score itself penalizes
 * reverts on a continuous ramp (`100 - revertRate * 6` in pulls.ts) — this is a UI-only attention
 * threshold: past ~10% of recent PRs being reverts, instability is a pattern worth calling out,
 * not noise. Strictly-greater-than: 10% exactly is still unflagged.
 */
export const REVERT_RATE_ELEVATED = 10;
