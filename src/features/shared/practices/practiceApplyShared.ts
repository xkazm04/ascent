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

/** A practice route's answer, read without trusting the body to be JSON. */
export type ApiRead<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

/**
 * Read a practice route's response for an inline control. Every control used to call `res.json()`
 * BEFORE checking `res.ok`, so a non-JSON error body (a platform timeout page, an empty 502) showed
 * the raw SyntaxError instead of the control's copy. Here a non-JSON or empty body is the caller's
 * `fallback`; a server error keeps its `error` text and its `code` (`content-drift` drives the
 * apply control). The shape of a successful body is the caller's to state.
 */
export async function readApiResponse<T>(res: Response, fallback: string): Promise<ApiRead<T>> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Not JSON, or empty: the fallback copy below is the answer the user sees.
  }
  const obj = body && typeof body === "object" ? (body as { error?: unknown; code?: unknown }) : null;
  if (res.ok && obj) return { ok: true, data: obj as T };
  const error = typeof obj?.error === "string" && obj.error ? obj.error : fallback;
  return typeof obj?.code === "string" ? { ok: false, error, code: obj.code } : { ok: false, error };
}
