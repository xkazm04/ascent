// ONE CELL OF THE OUTCOME MATRIX — what a single run delivered to a single repository.
//
// Extracted from `outcomeMatrix.ts` (which re-exports the two types, so no call site moved) when the
// per-cell economics landed and the module reached its 200-line cap. Pure relocation: the fold is
// unchanged apart from the economics it now carries.
//
// Every number answers to the same rule the rail's ledger used: `laneAttribution` decides whether a
// movement is printed as a delta or as a refusal word, and a per-dimension delta inherits that
// verdict and clears `attributeDimension` on its own. Nothing is summed that the rule declined.

import { attributeDimension, type Attribution } from "@/lib/maturity/attribution";
import { closedTitles, groupDeliverables } from "./outcomeDeliverables";
import { buildGapRows } from "./outcomeGapRows";
import { cellEconomics } from "./outcomeEconomics";
import type { CellRedBaseline, OutcomeCell, OutcomeDim } from "./outcomeMatrixTypes";
import { asVerifyVerdict } from "@/lib/local/verify-options";
import { dimShort } from "@/lib/ui";
import { laneAttribution } from "../cockpit/cockpitDrift";
import { laneKindTag, type LaneEconomics, type LoopLaneOutcome } from "../cockpit/loopTypes";

export type { OutcomeCell, OutcomeDim } from "./outcomeMatrixTypes";

function combineVerdicts(verdicts: readonly Attribution[]): Attribution {
  let sum = 0;
  let any = false;
  for (const v of verdicts) {
    if (v.kind === "attributable") {
      any = true;
      sum += v.delta;
    }
  }
  if (any) return { kind: "attributable", delta: sum };
  return verdicts[0] ?? { kind: "unmeasured" };
}

export function foldCell(
  runId: string,
  repo: string,
  lanes: readonly LoopLaneOutcome[],
  /** The run's per-lane economics, in the shape the detail route ships. Empty on an older payload. */
  economics: readonly LaneEconomics[] = [],
): OutcomeCell {
  const verdict = combineVerdicts(lanes.map(laneAttribution));
  const last = [...lanes].reverse().find((o) => o.diff) ?? lanes[lanes.length - 1]!;
  const dims: OutcomeDim[] = (last.diff?.dimensions ?? [])
    .filter((d) => d.delta != null && d.delta !== 0)
    .map((d) => ({
      id: d.id,
      short: dimShort(d.id),
      delta: d.delta as number,
      claimable: verdict.kind === "attributable" && attributeDimension(d.id, d.delta, last.before, last.after).kind === "attributable",
    }));
  const first = lanes[0]!;
  const tag = laneKindTag(first.kind);
  const titles = lanes.flatMap(closedTitles).filter((t, i, all) => all.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i);
  const tail = lanes[lanes.length - 1]!.lane;
  const withPr = [...lanes].reverse().find((o) => o.lane.prUrl != null)?.lane;
  // The cell's lanes, and only its lanes: an A/B run has two lanes on this repo in this cycle and
  // three more on another, and charging one repo's cell for another's spend is the failure the
  // org-wide average already makes.
  const laneIds = new Set(lanes.map((o) => o.lane.id));
  // AN UNAVAILABLE BASELINE OUTLIVES ITS LANE. The newest lane of this (run, repo) that measured a
  // verdict decides: a later verified lane means a baseline WAS established, and a stale badge would
  // say otherwise. Only `baseline-unavailable` is surfaced — `verified` on every healthy row would be
  // a badge meaning "normal", and `rejected` cannot reach this sheet at all because a rejected lane
  // commits nothing. Read through `asVerifyVerdict`, which also parses the word rows written before
  // 2026-08-31 carry (`baseline-red`).
  const red = [...lanes].reverse().find((o) => o.lane.verifyVerdict != null)?.lane ?? null;
  const redBaseline: CellRedBaseline | null =
    asVerifyVerdict(red?.verifyVerdict) === "baseline-unavailable" ? { command: red?.verifyCommand ?? null, note: red?.verifyNote ?? null } : null;
  return {
    runId,
    repo,
    kind: first.kind,
    installed: tag ? `${tag} installed` : null,
    deliverables: groupDeliverables(lanes),
    rows: buildGapRows(lanes),
    prNumber: withPr?.prNumber ?? null,
    prUrl: withPr?.prUrl ?? null,
    lane: withPr ?? tail,
    titles,
    verdict,
    commits: lanes.reduce((n, o) => n + o.commits, 0),
    gaps: lanes.reduce((n, o) => n + (o.diff?.closedGapCount ?? 0), 0),
    dims,
    redBaseline,
    economics: cellEconomics(economics.filter((e) => laneIds.has(e.laneId))),
    // A refused verdict has no movement prose: the number was declined, and a line saying what moved
    // is the same claim in words (wave-2 sample: a 0-commit lane printed `D9 -42: …` under "uncommitted").
    movements: verdict.kind === "attributable" ? (last.diff?.movements ?? []).slice(0, 2) : [],
    phase: tail.phase,
    stage: tail.stage,
    error: tail.error,
  };
}
