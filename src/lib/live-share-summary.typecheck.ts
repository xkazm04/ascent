/**
 * NEGATIVE ARTIFACT for the kiosk run summary (backlog develop-2026-09-17 row 43). Its pass condition
 * is a REFUSAL.
 *
 * Deliberately NOT named as a test: `tsconfig.json` excludes every `*.test.ts` from the typecheck, so a
 * type-level artifact in a test file is read by nothing and cannot fail (the same reason as
 * `src/lib/org/ids.typecheck.ts`). This file sits inside `include`, so `tsc` reads it.
 *
 * The invariant: the summary the shared war-room token page renders holds COUNTS ONLY, so a repo name,
 * branch, commit message, follow-up title or login cannot reach an unauthenticated kiosk.
 *
 * Seen red at birth (2026-09-24): with `CountsOnly` widened to `type CountsOnly<T> = T`, the first
 * `@ts-expect-error` below became an unused directive (TS2578) and the typecheck failed.
 */
import type { CountsOnly, KioskRunSummary } from "@/lib/live-share-summary";

// @ts-expect-error - a string field is not a count, so the summary shape cannot be given a repo name
type NamedShape = CountsOnly<{ runs: number; repo: string }>;

const counts: KioskRunSummary = { runs: 2, runWindow: 20, verifiedCloses: 5, pointsInReview: null };

const named: KioskRunSummary = {
  ...counts,
  // @ts-expect-error - the summary the strip renders has no slot for a name
  repo: "acme/api",
};

void counts;
void named;
void (null as NamedShape | null);
