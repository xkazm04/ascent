// What a gate-policy edit WOULD do, answered before the write. The editor used to decide blind: Save
// wrote the bar, a sweep re-posted Check Runs on open PRs, and only then did the tab show which repos
// went red - and only then was the owner told the save had also removed a bar.
//
// This is one more PROJECTION of the same enumeration (quality-gates/policy-projection), never a
// second rule: each repo is judged by `evaluateGateLite` on the policy the fleet resolver hands back
// for it (`gate-resolve.ts` folds the admission layer; nothing here re-folds), over the same
// rollup -> GateSnapshot mapping the governance tab uses (`fleet-gate-snapshot.ts`), with the same
// incomplete-scan bucket. Removed bars come from `diffGatePolicy`, the diff the POST writes to the
// audit row. Pure, no I/O.

import { evaluateGateLite, isIncompleteSnapshot, type GatePolicy, type GateResult, type GateSkip } from "@/lib/scoring/gate";
import { diffGatePolicy } from "@/lib/scoring/gate-diff";
import type { FleetGateRow } from "@/lib/org/fleet-gate-snapshot";

/** One side of the comparison: a bare policy (applied to every repo), or the STORED org bar plus the
 *  fleet resolver's per-repo effective policy (`FleetGatePolicies.policyFor`). */
export type ImpactSide = GatePolicy | { stored: GatePolicy | null; policyFor: (fullName: string) => GatePolicy };

export interface ImpactRepo {
  name: string;
  fullName: string;
  overall: number;
  /** For a repo turning red: every failure sentence under the draft. For one turning green: the
   *  sentences it fails on today, i.e. what the draft stops enforcing for it. */
  reasons: string[];
}

export interface GatePolicyImpact {
  /** Repos the gate can judge on both sides (scanned minus incomplete). */
  assessed: number;
  before: { passing: number; failing: number };
  after: { passing: number; failing: number };
  newlyFailing: ImpactRepo[];
  newlyPassing: ImpactRepo[];
  /**
   * Repos the draft would hold to a bar that cannot be judged for them and that they were NOT already
   * skipped on (e.g. a new protection bar on a repo whose protection nobody could read). Such a repo
   * passes that criterion by data starvation, so the count is said before the save, not discovered.
   */
  untested: Partial<Record<GateSkip["code"], number>>;
  /** Scans that scored nothing: no verdict on either side (the governance tab's third bucket). */
  unjudged: { incomplete: number };
  /** Bars the draft removes, as `{ label, was }` - the shape the POST's `dropped` reports. */
  removed: { label: string; was: string | null }[];
}

interface ResolvedSide {
  stored: GatePolicy | null;
  policyFor: (fullName: string) => GatePolicy;
}

function resolveSide(side: ImpactSide): ResolvedSide {
  if ("policyFor" in side && typeof side.policyFor === "function") return side as ResolvedSide;
  const policy = side as GatePolicy;
  return { stored: policy, policyFor: () => policy };
}

const skipCodes = (r: GateResult): Set<GateSkip["code"]> => new Set(r.skipped.map((s) => s.code));

/** Before/after over the SAME snapshots: two evaluator calls per repo, no rescan. */
export function gatePolicyImpact(rows: FleetGateRow[], current: ImpactSide, candidate: ImpactSide): GatePolicyImpact {
  const cur = resolveSide(current);
  const next = resolveSide(candidate);
  const out: GatePolicyImpact = {
    assessed: 0,
    before: { passing: 0, failing: 0 },
    after: { passing: 0, failing: 0 },
    newlyFailing: [],
    newlyPassing: [],
    untested: {},
    unjudged: { incomplete: 0 },
    removed: diffGatePolicy(cur.stored, next.stored)
      .filter((c) => c.kind === "removed")
      .map((c) => ({ label: c.label, was: c.before })),
  };

  for (const row of rows) {
    // Same rule the governance tab applies: an unscorable scan gets no verdict, so it can neither
    // flip red nor green here, it is counted apart.
    if (isIncompleteSnapshot(row.snapshot)) {
      out.unjudged.incomplete += 1;
      continue;
    }
    out.assessed += 1;
    const was = evaluateGateLite(row.snapshot, cur.policyFor(row.fullName));
    const will = evaluateGateLite(row.snapshot, next.policyFor(row.fullName));
    out.before[was.pass ? "passing" : "failing"] += 1;
    out.after[will.pass ? "passing" : "failing"] += 1;
    const base = { name: row.name, fullName: row.fullName, overall: row.snapshot.overall };
    if (was.pass && !will.pass) out.newlyFailing.push({ ...base, reasons: will.failures.map((f) => f.message) });
    if (!was.pass && will.pass) out.newlyPassing.push({ ...base, reasons: was.failures.map((f) => f.message) });
    const already = skipCodes(was);
    for (const code of skipCodes(will)) {
      if (!already.has(code)) out.untested[code] = (out.untested[code] ?? 0) + 1;
    }
  }

  // Lowest score first: the repo furthest below a new bar is the one the owner most needs to see.
  out.newlyFailing.sort((a, b) => a.overall - b.overall || a.fullName.localeCompare(b.fullName));
  out.newlyPassing.sort((a, b) => a.overall - b.overall || a.fullName.localeCompare(b.fullName));
  return out;
}
