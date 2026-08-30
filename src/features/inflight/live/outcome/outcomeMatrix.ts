// THE OUTCOME MATRIX — one column per run, one row-group per repo, one cell per (run, repo) holding
// what that run DELIVERED to that repo: one headline per deliverable (outcomeDeliverables.ts), the lane kind,
// and the movement it can attribute (prose and number under ONE verdict). Pure, so both variants render the same
// facts and a test can pin the fold without a DOM.
//
// Every number here answers to the same rule the rail's ledger used: `laneAttribution` decides whether
// a movement is printed as a delta or as a refusal word, and a per-dimension delta inherits that verdict
// and clears `attributeDimension` on its own. Nothing is summed that the rule declined.

import { attributeDimension, type Attribution } from "@/lib/maturity/attribution";
import { agentConfigLabel } from "@/lib/local/agent-options";
import type { LaneDeliverable } from "@/lib/db/loop-runs-types";
import { closedTitles, groupDeliverables } from "./outcomeDeliverables";
import { buildGapRows, type GapRow } from "./outcomeGapRows";
import { dimShort } from "@/lib/ui";
import { laneAttribution, runAttribution } from "../cockpit/cockpitDrift";
import { isRunLive, laneKindTag, type LoopLaneKind, type LoopLaneOutcome, type LoopLanePhase, type LoopRunDetail, type LoopRunPhase } from "../cockpit/loopTypes";

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
   *  standing review — what the Storyboard's expanded frame renders (outcomeGapRows.ts). */
  rows: GapRow[];
  /** The lane's PR, when an owner opened one — surfaced on the repo section header. */
  prNumber: number | null;
  prUrl: string | null;
  /** The full follow-up titles behind the `closed` headlines — evidence for the expanded view only. */
  titles: string[];
  verdict: Attribution;
  commits: number;
  gaps: number;
  dims: OutcomeDim[];
  /** Humanised movement lines (`D9 −42 · lost token permissions, SAST…`) — EMPTY unless the cell's
   *  verdict is attributable: the prose answers to the same rule as the number. */
  movements: string[];
  phase: LoopLanePhase;
  stage: string | null;
  error: string | null;
}

export interface OutcomeColumn {
  id: string;
  startedAt: string;
  endedAt: string | null;
  phase: LoopRunPhase;
  live: boolean;
  lift: number | null;
  agentConfig: string | null;
  cycle: number;
  maxCycles: number;
  repoCount: number;
  gaps: number;
}

export interface OutcomeGroup {
  repo: string;
  /** Cumulative attributable lift across the visible columns; null when no cell is attributable. */
  lift: number | null;
  cells: Record<string, OutcomeCell>;
}

export interface OutcomeMatrix {
  columns: OutcomeColumn[];
  groups: OutcomeGroup[];
  latestId: string | null;
  totals: { lift: number | null; runs: number; gaps: number; repos: number };
}

/** Later sources replace earlier ones by run id — the settled/live detail outranks the SSR snapshot. */
export function mergeRunDetails(base: readonly LoopRunDetail[], ...overrides: (LoopRunDetail | null | undefined)[]): LoopRunDetail[] {
  const byId = new Map(base.map((d) => [d.run.id, d]));
  for (const d of overrides) if (d) byId.set(d.run.id, d);
  return [...byId.values()];
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

function foldCell(runId: string, repo: string, lanes: readonly LoopLaneOutcome[]): OutcomeCell {
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
  return {
    runId,
    repo,
    kind: first.kind,
    installed: tag ? `${tag} installed` : null,
    deliverables: groupDeliverables(lanes),
    rows: buildGapRows(lanes),
    prNumber: withPr?.prNumber ?? null,
    prUrl: withPr?.prUrl ?? null,
    titles,
    verdict,
    commits: lanes.reduce((n, o) => n + o.commits, 0),
    gaps: lanes.reduce((n, o) => n + (o.diff?.closedGapCount ?? 0), 0),
    dims,
    // A refused verdict has no movement prose: the number was declined, and a line saying what moved
    // is the same claim in words (wave-2 sample: a 0-commit lane printed `D9 -42: …` under "uncommitted").
    movements: verdict.kind === "attributable" ? (last.diff?.movements ?? []).slice(0, 2) : [],
    phase: tail.phase,
    stage: tail.stage,
    error: tail.error,
  };
}

export function buildOutcomeMatrix(details: readonly LoopRunDetail[]): OutcomeMatrix {
  const sorted = [...details].sort((a, b) => a.run.startedAt.localeCompare(b.run.startedAt));
  const columns: OutcomeColumn[] = [];
  const cellsByRepo = new Map<string, Record<string, OutcomeCell>>();
  for (const d of sorted) {
    const byRepo = new Map<string, LoopLaneOutcome[]>();
    for (const o of d.outcomes) byRepo.set(o.lane.repoFullName, [...(byRepo.get(o.lane.repoFullName) ?? []), o]);
    let gaps = 0;
    for (const [repo, lanes] of byRepo) {
      const cell = foldCell(d.run.id, repo, lanes);
      gaps += cell.gaps;
      cellsByRepo.set(repo, { ...(cellsByRepo.get(repo) ?? {}), [d.run.id]: cell });
    }
    columns.push({
      id: d.run.id,
      startedAt: d.run.startedAt,
      endedAt: d.run.endedAt,
      phase: d.run.phase,
      live: isRunLive(d.run.phase),
      lift: runAttribution(d).lift,
      agentConfig: agentConfigLabel(d.run),
      cycle: d.run.cycle,
      maxCycles: d.run.maxCycles,
      repoCount: byRepo.size,
      gaps,
    });
  }
  const latest = columns[columns.length - 1] ?? null;
  const latestRepos = new Set(latest ? Object.keys(cellsByRepo).filter((r) => cellsByRepo.get(r)?.[latest.id]) : []);
  // Repos the latest run touched lead, then the rest — the reader's eye lands on the newest column and
  // should meet its rows first, not scroll past repos it did not touch.
  const groups: OutcomeGroup[] = [...cellsByRepo.entries()]
    .map(([repo, cells]) => {
      const att = Object.values(cells).map((c) => c.verdict).filter((v): v is Extract<Attribution, { kind: "attributable" }> => v.kind === "attributable");
      return { repo, lift: att.length ? att.reduce((n, v) => n + v.delta, 0) : null, cells };
    })
    .sort((a, b) => Number(latestRepos.has(b.repo)) - Number(latestRepos.has(a.repo)) || a.repo.localeCompare(b.repo));
  const lifts = columns.map((c) => c.lift).filter((l): l is number => l != null);
  return {
    columns,
    groups,
    latestId: latest?.id ?? null,
    totals: {
      lift: lifts.length ? lifts.reduce((n, l) => n + l, 0) : null,
      runs: columns.length,
      gaps: columns.reduce((n, c) => n + c.gaps, 0),
      repos: groups.length,
    },
  };
}
