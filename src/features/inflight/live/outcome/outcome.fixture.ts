// A hand-built OutcomeMatrix for the sheet's dom test — three runs, four repos,
// every verdict kind the fold can produce, a live lane and an errored one. Test-only. An attributable
// delta here is always outside the ±2 noise band, as the rule guarantees — a fixture that said
// `attributable +1` once put a `≈+1` on the page, a number the rule would have refused.

import type { LaneDeliverable } from "@/lib/db/loop-runs-types";
import type { LoopLaneRecord } from "../cockpit/loopTypes";
import type { GapRow } from "./outcomeGapRows";
import type { OutcomeCell, OutcomeColumn, OutcomeMatrix } from "./outcomeMatrix";

/** The lane a cell folded from — carried so the group header can offer the PR action. */
const laneOf = (o: Partial<OutcomeCell> & { runId: string; repo: string }): LoopLaneRecord => ({
  id: `lane-${o.repo}`, runId: o.runId, repoFullName: o.repo, cycle: 1, phase: o.phase ?? "done",
  branch: "ascent/loop-1", batchIds: [], closedIds: [], commits: o.commits ?? 0, beforeScanId: null,
  afterScanId: null, stage: o.stage ?? null, log: [], error: o.error ?? null, startedAt: null, endedAt: null,
  deliverables: [], prNumber: o.prNumber ?? null, prUrl: o.prUrl ?? null,
  model: null, costSource: null, costMicros: null, inputTokens: null, outputTokens: null,
  cacheReadTokens: null, turns: null, agentDurationMs: null, agentSessionId: null, abPairKey: null,
  brief: null, report: null, dimId: null,
});

const d = (headline: string, kind: LaneDeliverable["kind"], dimId: LaneDeliverable["dimId"] = null, evidence: string | null = null): LaneDeliverable => ({
  headline, kind, dimId, covers: [], evidence,
});

/** Gap rows derived from a cell's deliverables the way the fold would: committed on an attributable
 *  cell with commits, uncommitted at 0 commits, proposed for `noted`. Fixture-local shorthand. */
const rowsFor = (cell: OutcomeCell): GapRow[] =>
  cell.deliverables.map((del) => ({
    ...del,
    laneId: `lane-${cell.repo}`,
    state: del.kind === "noted" ? "proposed" : cell.commits === 0 ? "uncommitted" : "committed",
  }));

export const cell = (o: Partial<OutcomeCell> & { runId: string; repo: string }): OutcomeCell => {
  const base: OutcomeCell = {
    kind: "backlog", installed: null, deliverables: [], rows: [], prNumber: null, prUrl: null, lane: laneOf(o), titles: [],
    verdict: { kind: "unmeasured" }, commits: 0, gaps: 0, dims: [], movements: [],
    phase: "done", stage: null, error: null, ...o,
  };
  return o.rows ? base : { ...base, rows: rowsFor(base) };
};

const col = (o: Partial<OutcomeColumn> & { id: string; startedAt: string }): OutcomeColumn => ({
  endedAt: null, phase: "done", live: false, lift: null, agentConfig: "sonnet · high", cycle: 2, maxCycles: 3, repoCount: 0, gaps: 0, ...o,
});

const payments = (runId: string) => cell({
  runId, repo: "acme/payments-api", verdict: { kind: "attributable", delta: 6 }, commits: 3, gaps: 2,
  dims: [{ id: "D9", short: "Security", delta: 14, claimable: true }, { id: "D2", short: "Testing", delta: 4, claimable: true }],
  movements: ["D9 ▲+14 · gained token permissions, SAST"],
  deliverables: [
    d("Added a coverage gate to CI", "closed", "D2", "Add a coverage gate to CI"),
    d("Installed the .ai/ foundation", "installed"),
    d("Hardened CI/CD security", "hardened", "D9", "Token permissions [posture/high]: 0/10 → 8/10"),
    d("Improved commit hygiene", "hardened", "D7"),
    d("Added agent-readable docs", "hardened", "D8"),
  ],
});

export const fixture: OutcomeMatrix = {
  columns: [
    col({ id: "run-1", startedAt: "2026-08-21T10:00:00Z", lift: null, repoCount: 2, gaps: 0, agentConfig: "sonnet", cycle: 3 }),
    col({ id: "run-2", startedAt: "2026-08-25T10:00:00Z", lift: 6, repoCount: 3, gaps: 3, cycle: 3 }),
    col({ id: "run-3", startedAt: "2026-08-30T08:00:00Z", lift: 3, repoCount: 4, gaps: 2 }),
  ],
  groups: [
    { repo: "acme/payments-api", lift: 9, cells: { "run-2": cell({ ...payments("run-2"), verdict: { kind: "attributable", delta: 3 }, deliverables: payments("run-2").deliverables.slice(0, 2), rows: undefined }), "run-3": cell({ ...payments("run-3"), prNumber: 41, prUrl: "https://github.com/acme/payments-api/pull/41", rows: undefined }) } },
    {
      repo: "acme/docs-site", lift: -3,
      cells: {
        "run-3": cell({ runId: "run-3", repo: "acme/docs-site", verdict: { kind: "attributable", delta: -3 }, commits: 1, deliverables: [d("Regressed on documentation", "regressed", "D5", "README lost its setup section")] }),
      },
    },
    {
      repo: "acme/web-app", lift: 3,
      cells: {
        "run-1": cell({ runId: "run-1", repo: "acme/web-app", verdict: { kind: "within-noise", delta: 1 }, commits: 2, deliverables: [] }),
        "run-2": cell({ runId: "run-2", repo: "acme/web-app", verdict: { kind: "attributable", delta: 3 }, commits: 2, deliverables: [d("Strengthened automated testing", "closed", "D2")] }),
        "run-3": cell({ runId: "run-3", repo: "acme/web-app", verdict: { kind: "undelivered", delta: 5 }, commits: 0, deliverables: [d("Added AI tooling conventions", "closed", "D1", "Add a CLAUDE.md")] }),
      },
    },
    {
      repo: "acme/ingest", lift: null,
      cells: {
        "run-1": cell({ runId: "run-1", repo: "acme/ingest", verdict: { kind: "mock-scan", delta: 2, degraded: true }, commits: 1 }),
        "run-3": cell({ runId: "run-3", repo: "acme/ingest", phase: "rescanning", stage: "analyze", verdict: { kind: "unmeasured" }, commits: 2 }),
      },
    },
  ],
  latestId: "run-3",
  totals: { lift: 9, runs: 3, gaps: 5, repos: 4 },
};

const inFlight = (repo: string, phase: OutcomeCell["phase"], stage: string | null, commits = 0) =>
  cell({ runId: "run-3", repo, phase, stage, commits });

/** The same fleet with run 3 still running: its cells read their stage, nothing has landed yet. */
export const liveFixture: OutcomeMatrix = {
  ...fixture,
  columns: [...fixture.columns.slice(0, 2), col({ id: "run-3", startedAt: "2026-08-30T08:00:00Z", phase: "running", live: true, repoCount: 4, cycle: 1 })],
  groups: fixture.groups.map((g) => ({
    ...g,
    cells: {
      ...g.cells,
      "run-3":
        g.repo === "acme/payments-api" ? inFlight(g.repo, "rescanning", "analyze", 3)
        : g.repo === "acme/docs-site" ? inFlight(g.repo, "dispatching", null, 1)
        : g.repo === "acme/web-app" ? inFlight(g.repo, "queued", null)
        : cell({ runId: "run-3", repo: g.repo, phase: "error", error: "worktree checkout failed", commits: 0 }),
    },
  })),
};

export const emptyFixture: OutcomeMatrix = { columns: [], groups: [], latestId: null, totals: { lift: null, runs: 0, gaps: 0, repos: 0 } };
