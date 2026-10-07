// Timeline annotations — the "what happened here?" layer for the trend chart (G5-18).
//
// A jump or a dip on a trend line is descriptive; an annotated jump is diagnostic. Every marker below
// is derived from data the trends page ALREADY has in hand (the scan series: score, level, commit
// sha) — no extra query, no new table. Two event classes are derivable today:
//
//   • band crossings   — the scan where the repo changed maturity level (promotion / demotion)
//   • regressions      — a drop of at least `DEFAULT_THRESHOLDS.overallDrop` points against the
//                        previous scan, the SAME threshold the alerting path uses to call something a
//                        regression, so the chart and the alert email never disagree about what counts
//
// THE RULER: a consecutive pair scored under two provably different rubrics (`sameRuler === false`)
// measured the rubric bump, not the repository, so it never becomes a promotion, demotion or
// regression. It becomes one marker of kind "rubric" instead. Only a provable false refuses a pair; a
// pair with an end that records no rubric (null) takes the ordinary path, exactly as the alert lane
// does (scan-alerts.ts), so the chart and the alert email agree.
//
// DEPLOY MARKERS (kind "deploy") are NOT derived here: they come from persisted `Deployment` rows
// (the W4 GitHub Deployments ingest), pinned onto this same shape by `deployAnnotations.ts`. A
// marker derived from "a scan happened" is still never a deploy; only a stored deployment is.
//
// PURE + no React: safe to import from a server component, a client chart, or a test.

import { DEFAULT_THRESHOLDS } from "@/lib/alerts";
import type { HistoryPoint } from "@/lib/db/scans";
import { sameRuler } from "@/lib/maturity/attribution";

export type TrendAnnotationKind = "promotion" | "demotion" | "regression" | "rubric" | "deploy";

/**
 * One marker pinned to a point on the trend timeline.
 *
 * THE CHART CONTRACT (hand-off to the `TrendChart` owner): position the marker by matching `at`
 * against the point's `at` timestamp — never by array index, since the chart slices by range and the
 * annotation list does not. `label` is the ~8-character on-chart chip; `detail` is the hover/aria
 * text. Annotations outside the rendered range are simply not matched, which is the desired
 * behaviour — no clamping to the edge.
 */
export interface TrendAnnotation {
  /** ISO timestamp of the scan the marker pins to (identical string to that point's `at`). */
  at: string;
  /** Scan id — stable React key, and a handle for deep-linking. */
  scanId: string;
  kind: TrendAnnotationKind;
  /** Short on-chart chip, e.g. "L3 → L4" or "−7". */
  label: string;
  /** Full sentence for a tooltip / screen reader. */
  detail: string;
  /** Overall-score change vs the previous (older) scan. */
  delta: number;
  /** Short commit sha for DISPLAY when the scan was pinned to one, else null. */
  sha: string | null;
  /** FULL commit sha — what `reportPermalink` / `githubCommitUrl` must be given; a truncated sha
   *  would build a permalink that resolves to nothing. Null when the scan recorded no commit. */
  commitSha: string | null;
  /** Kind "deploy" only: the persisted deployments folded onto this scan. The marker reports the
   *  DEPLOYMENT's own status (`failed` counts `failure` / `error`), never an incident. */
  deploys?: { count: number; failed: number; environments: string[] };
}

/**
 * Derive markers from a scan series.
 *
 * @param scans        NEWEST-FIRST (the order every history reader returns).
 * @param overallDrop  points of decline that count as a regression; defaults to the alerting default.
 * @returns annotations NEWEST-FIRST, at most one per scan (a band crossing outranks a plain
 *          regression on the same scan — "dropped to L2" already says everything "−7" would).
 */
export function deriveTrendAnnotations(
  scans: readonly HistoryPoint[],
  overallDrop: number = DEFAULT_THRESHOLDS.overallDrop,
): TrendAnnotation[] {
  const out: TrendAnnotation[] = [];
  // Walk pairs (newer, older). The OLDEST scan has no predecessor, so it is never annotated — a
  // baseline is not an event.
  for (let i = 0; i < scans.length - 1; i++) {
    const now = scans[i]!; // safe: i < scans.length - 1
    const prev = scans[i + 1]!; // safe: i + 1 <= scans.length - 1
    const delta = now.overallScore - prev.overallScore;
    const sha = now.headSha ? now.headSha.slice(0, 7) : null;
    const base = { at: now.scannedAt, scanId: now.id, delta, sha, commitSha: now.headSha };

    if (sameRuler(prev.rubricVersion, now.rubricVersion) === false) {
      out.push({
        ...base,
        kind: "rubric",
        label: `${prev.rubricVersion} → ${now.rubricVersion}`,
        detail: `Scoring rubric changed from ${prev.rubricVersion} to ${now.rubricVersion}${sha ? ` at ${sha}` : ""}: the ${signed(delta)} point move here measures the rubric, not the repository.`,
      });
      continue;
    }
    if (now.level !== prev.level) {
      const promoted = now.overallScore > prev.overallScore;
      out.push({
        ...base,
        kind: promoted ? "promotion" : "demotion",
        label: `${prev.level} → ${now.level}`,
        detail: `${promoted ? "Promoted" : "Dropped"} from ${prev.level} to ${now.level} · ${now.levelName} (${signed(delta)} points)${sha ? ` at ${sha}` : ""}.`,
      });
      continue;
    }
    // `<=` on a NEGATIVE threshold: a drop of exactly `overallDrop` points regresses, matching
    // `detectRegression`'s `diff.overall.delta <= -thresholds.overallDrop` exactly.
    if (delta <= -overallDrop) {
      out.push({
        ...base,
        kind: "regression",
        label: `${signed(delta)}`,
        detail: `Regression: overall score fell ${Math.abs(delta)} points from ${prev.overallScore} to ${now.overallScore}${sha ? ` at ${sha}` : ""}.`,
      });
    }
  }
  return out;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}
