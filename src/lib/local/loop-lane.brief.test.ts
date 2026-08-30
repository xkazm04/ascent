// THE LOOP LEARNS FROM A "NO" (moonshot #25). Sibling of loop-lane.release.test.ts, which pins the
// claim/release contract and must keep passing untouched.
//
// Two rules are load-bearing here and neither existed before:
//   • an item the agent SKIPPED, with a reason, is parked — so the next cycle asks a different
//     question instead of spending another session being told the same thing;
//   • a verified close stamps ONLY the playbooks the lane's brief actually quoted. A close under a
//     playbook the agent never saw is a coincidence, and counting it as adoption would let the
//     adoption number climb on work the playbook had nothing to do with.

import { beforeEach, describe, expect, it, vi } from "vitest";

const lanePatches: Record<string, unknown>[] = [];
const logs: string[] = [];
const outcomeCalls: Record<string, unknown>[] = [];
const stampCalls: { repo: string; ids: readonly string[] }[] = [];
const deferred = new Set<string>();

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
vi.mock("@/lib/db/lane-outcomes", () => ({
  recordLaneOutcomes: vi.fn(async (input: Record<string, unknown>) => {
    outcomeCalls.push(input);
    return [];
  }),
  getActiveDeferrals: vi.fn(async () => deferred),
}));
vi.mock("@/lib/db/playbooks", () => ({
  stampPlaybookApplications: vi.fn(async (_org: string, repo: string, ids: readonly string[]) => {
    stampCalls.push({ repo, ids });
    return ids.length;
  }),
}));
vi.mock("@/lib/local/lane-cost", () => ({ recordAgentCost: vi.fn(async () => {}), excludeLaneReport: vi.fn(async () => {}) }));
vi.mock("@/lib/local/git", () => ({
  runGit: vi.fn(async (_dir: string, args: string[]) => ({ ok: true, stdout: args[0] === "rev-list" ? "1" : "sha", stderr: "" })),
}));
vi.mock("@/lib/db", () => ({ persistScanReport: vi.fn(async () => ({ scanId: "s" })), getLatestPlatformSignals: vi.fn(async () => null) }));
vi.mock("@/lib/db/org-insights", () => ({ getOrgBacklog: vi.fn(async () => null) }));
vi.mock("@/lib/scan", () => ({ scanRepository: vi.fn(async () => ({})) }));
vi.mock("@/lib/local/source", () => ({ LocalFsSource: class {} }));
vi.mock("@/lib/local/agent", () => ({ runClaudeAgent: vi.fn(async () => ({ ok: true, summary: "done" })) }));

import { runLane, type LaneDeps } from "@/lib/local/loop-lane";
import type { LaneReport } from "@/lib/local/lane-report";

const item = (id: string, dimId = "D3") => ({
  id,
  repo: "o/r",
  title: id,
  dimId,
  dimLabel: dimId,
  impact: "high",
  effort: "low",
  rationale: "",
  explore: [],
  projectedPoints: 3,
});

const briefInput = {
  org: "kiro",
  repo: "o/r",
  dimIds: ["D3"],
  playbooks: [{ id: "pb-briefed", title: "Ship gate", dimId: "D3", version: 2, summary: "s", steps: ["step"] }],
  housePattern: [],
  memories: [],
  skills: [],
  evidence: [],
};

const report = (over: Partial<LaneReport> = {}): LaneReport => ({ v: 1, parsed: true, items: [], lessons: [], ...over });

const deps = (over: Partial<LaneDeps> = {}): Partial<LaneDeps> => ({
  runAgent: vi.fn(async () => ({ ok: true, summary: "done" })) as never,
  commitWork: vi.fn(async () => ({ committed: true, files: 1, resolved: [], summary: "committed" })) as never,
  rescan: vi.fn(async () => ({ scanId: "scan-after", closedIds: [] })),
  openBatch: vi.fn(async () => [item("r1"), item("r2")]) as never,
  loadBrief: vi.fn(async () => briefInput) as never,
  readReport: vi.fn(async () => report()) as never,
  ...over,
});

const wt = { dir: "C:/tmp/wt", branch: "ascent/loop-x", created: true } as never;
const run = (over: Partial<LaneDeps> = {}, batch: string[] | null = null) =>
  runLane({ runId: "run", org: "kiro", repo: "o/r", cycle: 1, worktree: wt, batch, deps: deps(over) });

beforeEach(() => {
  lanePatches.length = 0;
  logs.length = 0;
  outcomeCalls.length = 0;
  stampCalls.length = 0;
  deferred.clear();
});

describe("the brief goes in", () => {
  it("records the brief's provenance on the row and names the playbook version in the prompt", async () => {
    const runAgent = vi.fn(async () => ({ ok: true, summary: "done" }));
    await run({ runAgent: runAgent as never });
    const brief = lanePatches.find((p) => "brief" in p)?.brief as { sections: { kind: string; refs: string[] }[] };
    expect(brief.sections.find((s) => s.kind === "playbook")!.refs).toEqual(["pb-briefed@2"]);
    const prompt = (runAgent.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).toContain("YOUR ORGANIZATION'S STANDARD");
    expect(prompt).toContain("playbook pb-briefed v2");
    // …and the report contract names exactly the dispatched ids.
    expect(prompt).toContain(".ascent/lane-report.json");
    expect(prompt).toContain("r1, r2");
  });

  it("dispatches with no brief rather than failing the lane when the reads are unavailable", async () => {
    const res = await run({
      loadBrief: vi.fn(async () => {
        throw new Error("db down");
      }) as never,
    });
    expect(res.error).toBeNull();
    expect(lanePatches.some((p) => "brief" in p)).toBe(false);
  });
});

describe("the report comes back", () => {
  it("persists the agent's report and hands its verdicts to the outcome writer", async () => {
    await run({
      readReport: vi.fn(async () => report({ items: [{ recommendationId: "r2", verdict: "skipped", reason: "needs a product call", files: [] }] })) as never,
    });
    const persisted = lanePatches.find((p) => "report" in p)?.report as LaneReport;
    expect(persisted.items[0]!.verdict).toBe("skipped");
    expect(outcomeCalls[0]).toMatchObject({ batchIds: ["r1", "r2"], closedIds: [] });
    expect((outcomeCalls[0]!.report as LaneReport).items[0]!.recommendationId).toBe("r2");
  });

  it("says the verdicts are UNKNOWN when no report was written, rather than nothing", async () => {
    await run({ readReport: vi.fn(async () => report({ parsed: false })) as never });
    expect(logs.some((l) => l.includes("per-item verdicts are unknown"))).toBe(true);
  });
});

describe("the playbook stamp is earned, not assumed", () => {
  it("stamps a briefed playbook when the RESCAN closed a row on its dimension", async () => {
    await run({ rescan: vi.fn(async () => ({ scanId: "scan-after", closedIds: ["r1"] })) as never });
    expect(stampCalls).toEqual([{ repo: "o/r", ids: ["pb-briefed"] }]);
  });

  it("stamps nothing when the close was on a dimension no briefed playbook covers", async () => {
    await run({
      openBatch: vi.fn(async () => [item("r1", "D9"), item("r2", "D9")]) as never,
      rescan: vi.fn(async () => ({ scanId: "scan-after", closedIds: ["r1"] })) as never,
    });
    expect(stampCalls).toEqual([]);
  });

  it("stamps nothing when the rescan closed nothing — a claim is not adoption evidence", async () => {
    await run({
      readReport: vi.fn(async () => report({ items: [{ recommendationId: "r1", verdict: "resolved", reason: "did it", files: [] }] })) as never,
    });
    expect(stampCalls).toEqual([]);
  });
});

describe("a deferral is advisory, and a human outranks it", () => {
  it("keeps a curated id that an earlier lane parked, and says so in the log", async () => {
    deferred.add("r2");
    await run({}, ["r2"]);
    // `includeDeferred` is passed for a curated batch, so the parked id is still offered…
    expect(logs.some((l) => l.includes("a named pick outranks a deferral"))).toBe(true);
    expect(outcomeCalls[0]).toMatchObject({ batchIds: ["r2"] });
  });

  it("asks openBatch to honour deferrals on an UNCURATED cycle", async () => {
    const openBatch = vi.fn(async () => [item("r1")]);
    await run({ openBatch: openBatch as never });
    expect(openBatch.mock.calls[0]![3]).toEqual({ includeDeferred: false });
  });
});
