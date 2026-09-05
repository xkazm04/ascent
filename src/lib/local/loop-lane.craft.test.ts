// THE CRAFT FALLBACK — `openBatch`'s behaviour at green, and the lane that dispatches it.
//
// THE FAILURE THIS PINS. Before r12 the loop ended the moment a repo's last gap closed: `openBatch`
// returned `[]`, the lane logged "nothing to dispatch" and closed, and a repository that had done
// everything the rubric asks got silence. Worse, craft rows were reaching the batch ACCIDENTALLY —
// `getOrgBacklog` filtered on `status` alone, so a craft entry could be dispatched mixed in with
// gaps, unordered, contradicting the schema's own comment. r12 makes the mixing deliberate and
// ordered: gaps always outrank craft, and craft is returned ONLY when no open gap remains.
//
// The campaign case is the one that has to work: a repo with an EMPTY gap backlog must produce a
// non-empty, dispatchable batch — not an empty one, which makes the lane a silent no-op.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FollowUpItem } from "@/lib/org/followups";
import type { CraftAxis } from "@/lib/scoring/craft";

const backlogItems: Record<string, unknown>[] = [];
const craftItems: FollowUpItem[] = [];
let ledger = { total: 0, byAxis: {} as Record<CraftAxis, number>, unaxised: 0 };
const deferred = new Set<string>();
let unmeasurableDims: string[] = [];
const logs: string[] = [];
const lanePatches: Record<string, unknown>[] = [];

vi.mock("@/lib/db/org-insights", () => ({
  getOrgBacklog: vi.fn(async () => ({ byOwner: [{ items: backlogItems }] })),
}));
vi.mock("@/lib/db/org-insights-craft", () => ({
  getCraftItems: vi.fn(async () => craftItems),
  getCraftLedger: vi.fn(async () => ledger),
}));
vi.mock("@/lib/db/lane-outcomes", () => ({
  getActiveDeferrals: vi.fn(async () => deferred),
  recordLaneOutcomes: vi.fn(async () => []),
}));
vi.mock("@/lib/db/scans-read", () => ({
  getLatestUnmeasurableDims: vi.fn(async () => unmeasurableDims),
}));
vi.mock("@/lib/db/scans-recommendations", () => ({ updateRecommendation: vi.fn(async (id: string) => ({ id })) }));
vi.mock("@/lib/db/loop-runs", () => ({
  upsertLane: vi.fn(async () => ({ id: "lane-1" })),
  updateLane: vi.fn(async (_id: string, patch: Record<string, unknown>) => {
    lanePatches.push(patch);
    return {};
  }),
  appendLaneLog: vi.fn(async (_id: string, line: string) => {
    logs.push(line);
  }),
  getLatestScanIdForRepo: vi.fn(async () => "scan-before"),
}));
vi.mock("@/lib/db/playbooks", () => ({ stampPlaybookApplications: vi.fn(async () => 0) }));
vi.mock("@/lib/db/loop-lessons", () => ({ recordLoopLessons: vi.fn(async () => {}) }));
vi.mock("@/lib/local/lane-cost", () => ({ recordAgentCost: vi.fn(async () => {}), excludeLaneReport: vi.fn(async () => {}) }));
vi.mock("@/lib/local/git", () => ({
  runGit: vi.fn(async (_dir: string, args: string[]) => ({ ok: true, stdout: args[0] === "rev-list" ? "1" : "sha", stderr: "" })),
}));
vi.mock("@/lib/db", () => ({ persistScanReport: vi.fn(async () => ({ scanId: "s" })), getLatestPlatformSignals: vi.fn(async () => null) }));
vi.mock("@/lib/scan", () => ({ scanRepository: vi.fn(async () => ({})) }));
vi.mock("@/lib/local/source", () => ({ LocalFsSource: class {} }));
vi.mock("@/lib/local/agent", () => ({ runClaudeAgent: vi.fn(async () => ({ ok: true, summary: "done" })) }));

import { openBatch, runLane, type LaneDeps } from "@/lib/local/loop-lane";
import { emptyAxisTally } from "@/lib/scoring/craft";

const gap = (id: string, impact = "high") => ({
  id,
  repo: "o/r",
  title: `gap ${id}`,
  dimId: "D3",
  dimLabel: "CI",
  impact,
  effort: "low",
  rationale: "",
  explore: [],
  projectedPoints: 3,
  status: "open",
});

const craft = (id: string, axis: CraftAxis | null, impact = "medium"): FollowUpItem => ({
  id,
  repo: "o/r",
  title: `rung ${id}`,
  dimId: "D2",
  dimLabel: "Testing",
  impact,
  effort: "medium",
  rationale: "The practice is present; this is the next rung.",
  explore: ["What fails first?"],
  projectedPoints: null,
  kind: "craft",
  craftAxis: axis,
});

beforeEach(() => {
  backlogItems.length = 0;
  craftItems.length = 0;
  deferred.clear();
  unmeasurableDims = [];
  logs.length = 0;
  lanePatches.length = 0;
  ledger = { total: 0, byAxis: emptyAxisTally(), unaxised: 0 };
});

describe("gaps always outrank craft", () => {
  it("a repo with BOTH open gaps and craft rungs gets a gaps-only batch", async () => {
    backlogItems.push(gap("g1"), gap("g2", "low"));
    craftItems.push(craft("c1", "performance"));

    const batch = await openBatch("kiro", "o/r");
    expect(batch.map((b) => b.id)).toEqual(["g1", "g2"]);
    expect(batch.some((b) => b.kind === "craft")).toBe(false);
  });

  it("a single open gap is still enough to keep craft out entirely", async () => {
    backlogItems.push(gap("g1"));
    craftItems.push(craft("c1", "performance"), craft("c2", "robustness"));
    const batch = await openBatch("kiro", "o/r");
    expect(batch.map((b) => b.id)).toEqual(["g1"]);
  });
});

describe("the craft fallback — where the loop used to die", () => {
  it("a repo with ZERO open gaps gets a NON-EMPTY craft batch", async () => {
    // The campaign case. An empty batch here makes the lane a silent no-op.
    craftItems.push(craft("c1", "performance"), craft("c2", "robustness"));
    const batch = await openBatch("kiro", "o/r");
    expect(batch.length).toBeGreaterThan(0);
    expect(batch.every((b) => b.kind === "craft")).toBe(true);
    expect(batch.every((b) => b.projectedPoints === null)).toBe(true);
  });

  it("ranks by AXIS COVERAGE first — the least-built axis leads", async () => {
    ledger = { total: 4, byAxis: { ...emptyAxisTally(), performance: 4 }, unaxised: 0 };
    // `performance` is the most-built axis, so its rung sorts last despite its higher impact.
    craftItems.push(craft("perf", "performance", "high"), craft("robust", "robustness", "low"));
    const batch = await openBatch("kiro", "o/r");
    expect(batch.map((b) => b.id)).toEqual(["robust", "perf"]);
  });

  it("breaks ties WITHIN an axis by the model's impact", async () => {
    craftItems.push(craft("low", "design", "low"), craft("high", "design", "high"));
    const batch = await openBatch("kiro", "o/r");
    expect(batch.map((b) => b.id)).toEqual(["high", "low"]);
  });

  it("sorts an axis-less rung last — nothing can be said about its coverage", async () => {
    craftItems.push(craft("none", null, "high"), craft("dx", "dx", "low"));
    const batch = await openBatch("kiro", "o/r");
    expect(batch.map((b) => b.id)).toEqual(["dx", "none"]);
  });

  it("a gap on a dimension the last scan could NOT OBSERVE is not armed, and craft takes over", async () => {
    // The measured failure: a worktree rescan observes no GitHub-side fold, so D2/D3/D4 read at their
    // file-scan floor whatever the agent builds. Arming a gap there spends a session to be told the
    // same thing next cycle — four campaign runs, eight lanes, every one on D4, both overalls flat.
    backlogItems.push(gap("g1")); // dimId D3 — a platform-fold dimension
    craftItems.push(craft("c1", "performance"));
    unmeasurableDims = ["D2", "D3", "D4"];

    const batch = await openBatch("kiro", "o/r");
    // Emptying the gap batch is the POINT: the craft ladder engages only when no open gap remains,
    // so before this it was unreachable behind a measurement artifact.
    expect(batch.map((b) => b.id)).toEqual(["c1"]);
    expect(batch.every((b) => b.kind === "craft")).toBe(true);
  });

  it("leaves a repo whose dimensions WERE observed completely unaffected", async () => {
    backlogItems.push(gap("g1"));
    craftItems.push(craft("c1", "performance"));
    unmeasurableDims = [];
    expect((await openBatch("kiro", "o/r")).map((b) => b.id)).toEqual(["g1"]);
  });

  it("skips only the unobservable dimensions — a gap elsewhere is still armed", async () => {
    backlogItems.push(gap("g1"), { ...gap("g2"), dimId: "D9" });
    unmeasurableDims = ["D2", "D3", "D4"];
    expect((await openBatch("kiro", "o/r")).map((b) => b.id)).toEqual(["g2"]);
  });

  it("honours a deferral on a craft rung exactly as it does on a gap", async () => {
    craftItems.push(craft("c1", "performance"), craft("c2", "robustness"));
    deferred.add("c1");
    const batch = await openBatch("kiro", "o/r");
    expect(batch.map((b) => b.id)).toEqual(["c2"]);
  });

  it("returns empty only when there is NEITHER a gap NOR a rung", async () => {
    expect(await openBatch("kiro", "o/r")).toEqual([]);
  });
});

describe("a craft batch actually dispatches", () => {
  const wt = { dir: "C:/tmp/wt", branch: "ascent/loop-x", created: true } as never;

  it("runs the AGENT (not the file installer) and briefs it to raise the ceiling", async () => {
    const runAgent = vi.fn(async () => ({ ok: true, summary: "done" }));
    const install = vi.fn(async () => ({ ok: true, committed: true, summary: "installed" }));
    craftItems.push(craft("c1", "performance"));

    const res = await runLane({
      runId: "run",
      org: "kiro",
      repo: "o/r",
      cycle: 1,
      worktree: wt,
      batch: null,
      kind: "craft",
      deps: {
        runAgent: runAgent as never,
        install: install as never,
        commitWork: vi.fn(async () => ({ committed: true, files: 1, resolved: [], summary: "committed" })) as never,
        rescan: vi.fn(async () => ({ scanId: "scan-after", closedIds: [] })),
        loadBrief: vi.fn(async () => null) as never,
        readReport: vi.fn(async () => ({ v: 1, parsed: true, items: [], lessons: [] })) as never,
      } as Partial<LaneDeps>,
    });

    expect(res.error).toBeNull();
    // A `kind !== "backlog"` test would have routed this into the deterministic installer.
    expect(install).not.toHaveBeenCalled();
    expect(runAgent).toHaveBeenCalledTimes(1);

    const prompt = (runAgent.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).toContain("craft ladder");
    expect(prompt).toContain("raise the ceiling");
    expect(prompt).toContain("Leave an ARTEFACT");
    // The lane parser's contract is unchanged — a craft session still ends with RESOLVED lines.
    expect(prompt).toContain("RESOLVED: <id> - <what changed>");
    // The rung was CLAIMED, so the next rescan's trailer feedback applies to it.
    expect(lanePatches.some((p) => Array.isArray(p.batchIds) && (p.batchIds as string[]).includes("c1"))).toBe(true);
  });
});
