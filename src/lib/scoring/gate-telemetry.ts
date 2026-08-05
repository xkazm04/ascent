// One structured line per PRODUCED gate verdict, from every surface that produces one.
//
// The question this exists to answer is "how often does the gate actually block a merge, and on which
// condition" — and nothing could answer it. The governance fleet view computes a pass rate by
// re-evaluating STORED SCANS on page load, which is a snapshot of the fleet, not a record of gate
// TRAFFIC: it cannot distinguish a bar nothing ever hits from one blocking PRs hourly, and it never
// sees the ref-scoped PR verdicts (a ?ref gate scores a commit that is never the repo's standing) or
// the verdicts that failed to produce at all. Those are exactly the events worth counting.
//
// Deliberately a log line and not a table: gate calls are CI-frequency, so a row per verdict would be
// a write-heavy store nobody asked for, and the useful queries (rate over time, top failing condition,
// degraded share) are aggregations a log drain already does well. The repo's house pattern is a
// `[surface] …` prefixed console line; this keeps the prefix and makes the payload JSON so it can be
// queried rather than grepped.

import type { GateResult } from "@/lib/scoring/gate";
import type { ScanReport } from "@/lib/types";

/** Which surface produced the verdict — they have different consequences and different failure modes. */
export type GateSurface =
  /** GET /api/gate — the public CI endpoint; a non-2xx fails the caller's build. */
  | "api"
  /** The App-mode Check Run — the status that can actually block a merge in branch protection. */
  | "check-run";

/** Where the enforced bar came from, so a "nobody is gated" reading can be told from "nobody fails". */
export type GatePolicySource =
  /** The org's persisted policy (optionally tightened by query params). */
  | "org"
  /** Query params over the archetype default — no persisted org bar. */
  | "params"
  /** The archetype default alone. */
  | "archetype";

export interface GateVerdictEvent {
  surface: GateSurface;
  /** "owner/repo", already normalized. */
  repo: string;
  /** The ref that was scored, when it wasn't the default branch (a PR head sha). */
  ref?: string | null;
  policySource: GatePolicySource;
  /** True when the grade could not be produced authoritatively (the verdict is not trustworthy). */
  degraded?: boolean;
  /** False for the App fallback verdict, which scored the default branch rather than the PR head. */
  scoredHead?: boolean;
}

/**
 * Emit one queryable line for a gate verdict. Never throws — telemetry must not be able to break the
 * gate it is observing, and `blocked` is stated explicitly rather than inferred from `pass` so a
 * degraded or non-authoritative verdict is never counted as a repository failing the bar.
 */
export function logGateVerdict(report: ScanReport, gate: GateResult, e: GateVerdictEvent): void {
  try {
    const authoritative = !e.degraded && e.scoredHead !== false;
    console.info(
      `[gate:verdict] ${JSON.stringify({
        surface: e.surface,
        repo: e.repo,
        ref: e.ref ?? null,
        pass: gate.pass,
        // The measurement that matters: a verdict that actually stops a merge. A degraded grade or a
        // default-branch fallback fails/neutrals for reasons that are NOT the repo being below the bar,
        // so counting them as blocks would overstate the gate's bite.
        blocked: authoritative && !gate.pass,
        degraded: e.degraded ?? false,
        authoritative,
        // Which conditions bite, deduped — the fleet view can rank these across stored scans, but only
        // this can rank them across the PRs teams are actually pushing.
        codes: [...new Set(gate.failures.map((f) => f.code))],
        policySource: e.policySource,
        level: report.level?.id ?? null,
        overall: report.overallScore ?? null,
        posture: report.posture?.id ?? null,
        archetype: report.archetype ?? null,
        engine: report.engine?.provider ?? null,
      })}`,
    );
  } catch {
    // A telemetry failure is never the gate's problem.
  }
}
