// THE OUTCOME MATRIX — one column per run, one row-group per repo, one cell per (run, repo) holding
// what that run DELIVERED to that repo: one headline per deliverable (outcomeDeliverables.ts), the lane kind,
// and the movement it can attribute (prose and number under ONE verdict). Pure, so a test can pin the
// fold without a DOM; outcomeSheet.ts re-cuts it into the sheet's cross-run row axis.
//
// Every number here answers to the same rule the rail's ledger used: `laneAttribution` decides whether
// a movement is printed as a delta or as a refusal word, and a per-dimension delta inherits that verdict
// and clears `attributeDimension` on its own. Nothing is summed that the rule declined.

import type { Attribution } from "@/lib/maturity/attribution";
import { agentConfigLabel } from "@/lib/local/agent-options";
// The per-cell fold lives beside this module (outcomeCellFold.ts) and the shapes in
// outcomeMatrixTypes.ts — both extracted at the 200-line cap, both re-exported below so no call
// site had to move.
import { foldCell } from "./outcomeCellFold";
import { runAttribution } from "../cockpit/cockpitDrift";
import { deliveryTag, isRunLive, runEngineLabel, type LoopLaneOutcome, type LoopRunDetail } from "../cockpit/loopTypes";
import type { OutcomeCell, OutcomeColumn, OutcomeGroup, OutcomeMatrix } from "./outcomeMatrixTypes";

export type {
  CellRedBaseline,
  OutcomeCell,
  OutcomeColumn,
  OutcomeDim,
  OutcomeGroup,
  OutcomeMatrix,
} from "./outcomeMatrixTypes";
export type { CellEconomics } from "./outcomeEconomics";

/** Later sources replace earlier ones by run id — the settled/live detail outranks the SSR snapshot. */
export function mergeRunDetails(base: readonly LoopRunDetail[], ...overrides: (LoopRunDetail | null | undefined)[]): LoopRunDetail[] {
  const byId = new Map(base.map((d) => [d.run.id, d]));
  for (const d of overrides) if (d) byId.set(d.run.id, d);
  return [...byId.values()];
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
      const cell = foldCell(d.run.id, repo, lanes, d.economics ?? []);
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
      // Derived from the lanes' recorded `executor`, not from a run-row column — there is none, and
      // the fact does not need one (MC-B44). `lanes` is the run's full lane set; `outcomes` is only
      // the lanes that produced a before/after, so folding over that would let one unfinished remote
      // lane silently make a run read "claude CLI".
      engine: runEngineLabel(d.lanes),
      delivery: deliveryTag(d.run.delivery),
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
