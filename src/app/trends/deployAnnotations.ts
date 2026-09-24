// Deploy markers for the trend timeline: persisted `Deployment` rows pinned onto scans.
//
// The chart's x axis is the scan series, not wall-clock time, so a deployment cannot sit "between"
// two points; it is pinned to the scan that answers "what did the repo measure after this shipped?":
//
//   1. SHA EQUALITY FIRST. A deployment whose sha equals a scan's `headSha` shipped exactly the code
//      that scan measured, so it pins there (the oldest such scan, the first to measure it). Same
//      rule as delivery-outcomes attribution: an equality, never a nearest-in-time guess, when one
//      is available.
//   2. ELSE THE FIRST SCAN AFTER IT. A deployment created in (older scan, newer scan] pins to the
//      newer one.
//
// Not placed: a deployment before the baseline scan (no window to fall in), one after the newest
// scan (nothing has measured it yet), and one with an unparseable time. A COMPACTED period is never
// a pin target: it is a mean over deleted scans, not a scan. No rows in, no markers out.
//
// The marker says what the Deployments API can observe, the deployment's own status, and says it is
// not an incident; a failure is counted in the label, never folded into a quiet "deploy".
//
// PURE + no React.

import type { TrendAnnotation } from "@/app/trends/annotations";
import type { HistoryPoint } from "@/lib/db/scans";
import type { RepoDeployment } from "@/lib/db/repo-deployments";
import { FAILED_STATES } from "@/lib/github/deployments";

/** Deployments spelled out in one marker's detail sentence; the rest are counted, not listed. */
export const MAX_DEPLOYS_IN_DETAIL = 5;

/**
 * @param scans        NEWEST-FIRST history (compacted points allowed; they are skipped).
 * @param deployments  this repo's persisted deployments, any order.
 * @returns at most one "deploy" annotation per real scan, NEWEST-FIRST.
 */
export function deriveDeployAnnotations(
  scans: readonly HistoryPoint[],
  deployments: readonly RepoDeployment[],
): TrendAnnotation[] {
  const real = scans.filter((s) => !s.compacted);
  if (real.length === 0 || deployments.length === 0) return [];
  const times = real.map((s) => Date.parse(s.scannedAt));

  const pinned = new Map<number, { dep: RepoDeployment; t: number }[]>();
  for (const dep of deployments) {
    const t = Date.parse(dep.createdAt);
    if (Number.isNaN(t)) continue;
    const i = pinIndex(real, times, dep.sha.toLowerCase(), t);
    if (i === null) continue;
    const bucket = pinned.get(i) ?? [];
    bucket.push({ dep, t });
    pinned.set(i, bucket);
  }

  const out: TrendAnnotation[] = [];
  for (const i of [...pinned.keys()].sort((a, b) => a - b)) {
    const scan = real[i]!; // safe: i is an index pinIndex returned into `real`
    const older = real[i + 1];
    const deps = pinned.get(i)!.sort((a, b) => b.t - a.t).map((p) => p.dep); // safe: key from the map
    const failed = deps.filter((d) => FAILED_STATES.has(d.state)).length;
    const listed = deps.slice(0, MAX_DEPLOYS_IN_DETAIL).map(describe);
    if (deps.length > MAX_DEPLOYS_IN_DETAIL) listed.push(`and ${deps.length - MAX_DEPLOYS_IN_DETAIL} more`);
    out.push({
      at: scan.scannedAt,
      scanId: scan.id,
      kind: "deploy",
      label: failed > 0 ? `${failed} failed` : deps.length === 1 ? "deploy" : `${deps.length} deploys`,
      detail: `Deployment status, not incidents: ${deps.length} deployment${deps.length === 1 ? "" : "s"}${failed > 0 ? ` (${failed} failed)` : ""}: ${listed.join("; ")}.`,
      delta: older ? scan.overallScore - older.overallScore : 0,
      sha: scan.headSha ? scan.headSha.slice(0, 7) : null,
      commitSha: scan.headSha,
      deploys: { count: deps.length, failed, environments: [...new Set(deps.map((d) => d.environment))].sort() },
    });
  }
  return out;
}

/** Score events and deploy markers as one newest-first legend; a score event leads on a shared scan. */
export function mergeTimelineEvents(
  scoreEvents: readonly TrendAnnotation[],
  deployEvents: readonly TrendAnnotation[],
): TrendAnnotation[] {
  // Array#sort is stable, so equal timestamps keep score-events-then-deploys order.
  return [...scoreEvents, ...deployEvents].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

function pinIndex(real: readonly HistoryPoint[], times: readonly number[], sha: string, t: number): number | null {
  for (let i = real.length - 1; i >= 0; i--) {
    if (sha && real[i]!.headSha?.toLowerCase() === sha) return i; // safe: i in [0, length)
  }
  // Oldest-to-newest: the first scan at or after the deployment. The baseline (last index) has no
  // older scan to open a window, so a deployment at or before it is not placed.
  for (let i = real.length - 1; i >= 0; i--) {
    if (times[i]! >= t) return i < real.length - 1 ? i : null; // safe: times parallels real
  }
  return null;
}

function describe(d: RepoDeployment): string {
  return `${d.environment} ${d.state} at ${d.sha.slice(0, 7)} on ${d.createdAt.slice(0, 10)}`;
}
