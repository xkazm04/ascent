// The ONE rollup-row -> GateSnapshot mapping. The governance fleet view and the gate-policy preview
// both judge a repo from its persisted rollup numbers (evaluateGateLite); a mapping copied per
// surface is how the two would come to judge different inputs - the preview would then forecast a
// verdict the tab never shows. Pure, no I/O.

import type { GateSnapshot } from "@/lib/scoring/gate";
import type { OrgRepoRow } from "@/lib/db/org-rollup";

type LatestScan = NonNullable<OrgRepoRow["latest"]>;

/** The fields evaluateGateLite reads, copied from a rollup row's latest scan. `incomplete` travels so
 *  the evaluator's fail-closed short-circuit sees the same flag the fleet view buckets on. */
export function gateSnapshotOf(s: LatestScan): GateSnapshot {
  return {
    level: s.level,
    overall: s.overall,
    posture: s.posture,
    dims: s.dims,
    incomplete: s.incomplete,
    protected: s.protected,
    govReadable: s.govReadable,
    aiGovernedRate: s.aiGovernedRate,
    aiPrSample: s.aiPrSample,
  };
}

export interface FleetGateRow {
  name: string;
  fullName: string;
  snapshot: GateSnapshot;
}

/** Every SCANNED repo of a rollup as a gateable row (never-scanned repos carry no verdict). */
export function fleetGateRows(repos: Pick<OrgRepoRow, "name" | "fullName" | "latest">[]): FleetGateRow[] {
  return repos.flatMap((r) => (r.latest ? [{ name: r.name, fullName: r.fullName, snapshot: gateSnapshotOf(r.latest) }] : []));
}
