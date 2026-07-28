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
// DEPLOY / RELEASE MARKERS: intentionally not invented here. Ascent ingests no deploy or release feed
// yet, and a marker derived from "a scan happened" is not a deploy. When such a feed lands, it maps
// onto this same `TrendAnnotation` shape (`at` + `kind` + labels) and everything downstream — this
// module's consumers and the chart's rendering contract — keeps working unchanged.
//
// PURE + no React: safe to import from a server component, a client chart, or a test.

import { DEFAULT_THRESHOLDS } from "@/lib/alerts";
import type { HistoryPoint } from "@/lib/db/scans";

export type TrendAnnotationKind = "promotion" | "demotion" | "regression";

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
