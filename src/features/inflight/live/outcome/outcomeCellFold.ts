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
import type { LaneDeliverable } from "@/lib/db/loop-runs-types";
import { closedTitles, groupDeliverables } from "./outcomeDeliverables";
import { buildGapRows, type GapRow } from "./outcomeGapRows";
import { cellEconomics, type CellEconomics } from "./outcomeEconomics";
import { dimShort } from "@/lib/ui";
import { laneAttribution } from "../cockpit/cockpitDrift";
import { laneKindTag, type LaneEconomics, type LoopLaneKind, type LoopLaneOutcome, type LoopLanePhase, type LoopLaneRecord } from "../cockpit/loopTypes";

export interface OutcomeDim {
  id: string;
  short: string;
  delta: number;
  /** The pair is attributable AND this dimension's fold is comparable — the only case coloured. */
  claimable: boolean;
}

export interface OutcomeCell {
  runId: string;
  repo: string;
  kind: LoopLaneKind;
  /** "…installed" line for a deterministic lane; null for an agent lane (no tag says more than one). */
  installed: string | null;
  /** WHAT THE LANE DID, one headline each — grouped by kind (closed · installed · hardened ·
   *  regressed) then by dimension. */
  deliverables: LaneDeliverable[];
  /** ONE ROW PER GAP, with its state (committed · uncommitted · proposed), its lane and any
   *  standing review — the sheet's row axis is folded from these (outcomeGapRows.ts). */
  rows: GapRow[];
  /** The lane's PR, when an owner opened one — surfaced on the repo's group-header row. */
  prNumber: number | null;
  prUrl: string | null;
  /** The lane the group header offers the PR action against (the one that already has a PR, else the
   *  last). Carried whole because `LanePrAction` decides eligibility from the record itself. */
  lane: LoopLaneRecord;
  /** The full follow-up titles behind the `closed` headlines — evidence for the expanded view only. */
  titles: string[];
  verdict: Attribution;
  commits: number;
  gaps: number;
  dims: OutcomeDim[];
  /** WHAT THIS CELL SPENT, and what it bought (`outcomeEconomics.ts`). NULL when the payload carried
   *  no lane economics at all — a server older than the ledger renders nothing, never a zero. */
  economics: CellEconomics | null;
  /** Humanised movement lines (`D9 −42 · lost token permissions, SAST…`) — EMPTY unless the cell's
   *  verdict is attributable: the prose answers to the same rule as the number. */
  movements: string[];
  phase: LoopLanePhase;
  stage: string | null;
  error: string | null;
}

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
    economics: cellEconomics(economics.filter((e) => laneIds.has(e.laneId))),
    // A refused verdict has no movement prose: the number was declined, and a line saying what moved
    // is the same claim in words (wave-2 sample: a 0-commit lane printed `D9 -42: …` under "uncommitted").
    movements: verdict.kind === "attributable" ? (last.diff?.movements ?? []).slice(0, 2) : [],
    phase: tail.phase,
    stage: tail.stage,
    error: tail.error,
  };
}
