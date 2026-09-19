export interface RepoRef {
  name: string;
  fullName: string;
}

/** Wire `shape` from POST /api/practices/generate — which starter the preview actually is. */
export type PracticePreviewShape =
  | { kind: "house"; exemplars: number }
  | { kind: "generic" };

export interface Artifact {
  path: string;
  body: string;
  /** The repo this artifact was previewed for. Apply must target THIS repo, not whatever the dropdown
   *  reads now — otherwise a stale preview response can be applied to a different repo (see preview()). */
  repo: string;
  /** House vs generic: the one-line kicker above the previewed artifact. */
  shape: PracticePreviewShape;
}

/**
 * A starter PR for this practice that is still OPEN on a repo (from the practice's ImprovementPr
 * lifecycle, projected by getOrgPractices as `openPrs`). Applying again would only re-surface the
 * same `ascent/<practice>` branch, so the apply UI links the live PR instead of offering a duplicate.
 */
export interface OpenPrRef {
  repoFullName: string;
  prNumber: number;
  prUrl: string;
}

// Single-sourced with the server (src/app/api/practices/apply-batch/route.ts imports this type). It
// used to declare its own equivalent `RepoResult` including a `number` (PR number) field that no
// client ever read — confirmed by a repo-wide grep of PracticeApplyBatch.tsx / PracticeApplyBatchResults
// before dropping it, so it shipped on the wire for nothing.
export interface BatchResult {
  repo: string;
  ok: boolean;
  url?: string;
  reused?: boolean;
  error?: string;
}

// Mirror the server's per-batch cap (src/app/api/practices/apply-batch/route.ts MAX_BATCH). The route
// truncates to the FIRST MAX_BATCH repos it receives and returns the over-cap count as `skipped`, so we
// (a) send the neediest repos first and (b) surface `skipped` instead of implying full coverage.
export const MAX_BATCH = 25;
