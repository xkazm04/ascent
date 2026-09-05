// The `progress` frame contract of the fleet scan stream (POST /api/org/scan), as one pure fold.
//
// The stream emits TWO kinds of progress frame and the difference is easy to get wrong:
//
//   { stage: "scan", repo, index, total }                  — repo boundary; `index` is repos HANDLED
//   { stage: "fetch"|"tree"|"files"|"analyze"|"score"|"compose", repo, index, total, pct }
//                                                          — SUB-progress inside the current repo
//
// Both carry the same `index`/`total`, on purpose: a sub-stage is not a unit of fleet progress, and a
// consumer must never count one as a repo. That invariant is only safe while every consumer ASSIGNS
// `done = index` rather than incrementing it — which is exactly what this fold does, once, for all of
// them, so the rule has a place to be tested instead of living implicitly in four call sites.
//
// Pure and browser-safe: no React, no server imports.

/** The scanner's own stages, in order. `"scan"` (the repo boundary) is deliberately not one of them. */
export const SCAN_SUBSTAGES = ["fetch", "tree", "files", "analyze", "score", "compose"] as const;
export type ScanSubstage = (typeof SCAN_SUBSTAGES)[number];

const SUBSTAGES: ReadonlySet<string> = new Set(SCAN_SUBSTAGES);

/** True for a sub-progress frame — i.e. anything that is NOT the `"scan"` repo boundary. */
export function isSubstageFrame(stage: unknown): stage is ScanSubstage {
  return typeof stage === "string" && SUBSTAGES.has(stage);
}

/** Human copy for a sub-stage, for a "· analyzing" suffix next to the repo name. */
export const SUBSTAGE_LABEL: Record<ScanSubstage, string> = {
  fetch: "fetching",
  tree: "reading the tree",
  files: "reading files",
  analyze: "analyzing",
  score: "scoring",
  compose: "composing",
};

export interface ScanProgressState {
  /** Repos HANDLED so far (skips included) — the progress numerator. */
  done: number;
  /** Repos this run will attempt. */
  total: number;
  /** The repo currently being worked, or "" between repos. */
  current: string;
  /** The current repo's sub-stage, or null at a repo boundary. */
  stage: ScanSubstage | null;
}

/**
 * Fold one `progress` frame into progress state.
 *
 * `index`/`total` are ASSIGNED (never incremented) and fall back to the previous value when the frame
 * omits or garbles them, so a malformed frame is inert rather than destructive. A `"scan"` boundary
 * clears `stage`; a sub-stage frame sets it and leaves the counters where the boundary put them.
 */
export function foldProgressFrame(prev: ScanProgressState, data: Record<string, unknown>): ScanProgressState {
  const index = Number(data.index);
  const total = Number(data.total);
  const stage = data.stage;
  return {
    done: Number.isFinite(index) && index >= 0 ? index : prev.done,
    total: Number.isFinite(total) && total > 0 ? total : prev.total,
    current: typeof data.repo === "string" ? data.repo : prev.current,
    stage: isSubstageFrame(stage) ? stage : null,
  };
}
