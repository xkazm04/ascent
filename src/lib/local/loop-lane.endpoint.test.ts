// THE ENDPOINT REACHES THE SPAWN (spark local-model-lanes, WP11).
//
// `TransportRunOptions.endpoint` was honoured by `claudeSpawnEnv` and by `piModelsJson` from the day
// it existed, and no caller passed one — so a lane could be armed, validated, persisted, probed and
// rendered while still talking to the subscription seat. These pin the EXECUTING door: the arm's
// resolved endpoint is on the options object `runAgentVia` is called with, and a hosted arm still
// sends no key at all.

import { beforeEach, describe, expect, it, vi } from "vitest";

const patches: Record<string, unknown>[] = [];

vi.mock("@/lib/db/scans-recommendations", () => ({ updateRecommendation: vi.fn(async (id: string) => ({ id })) }));
vi.mock("@/lib/db/followup-claims", () => ({
  claimFollowups: vi.fn(async ({ ids }: { ids: string[] }) => ({ claimed: ids.map((id) => ({ id })), refused: [] })),
  releaseFollowups: vi.fn(async (ids: string[]) => ids.length),
}));
vi.mock("@/lib/db/loop-runs", () => ({
  upsertLane: vi.fn(async () => ({ id: "lane-1" })),
  updateLane: vi.fn(async (_id: string, patch: Record<string, unknown>) => {
    patches.push(patch);
    return {};
  }),
  appendLaneLog: vi.fn(async () => {}),
  getLatestScanIdForRepo: vi.fn(async () => "scan-before"),
}));
vi.mock("@/lib/db/loop-lessons", () => ({
  recordLoopLessons: vi.fn(async () => []),
  recordRedBaselineLesson: vi.fn(async () => null),
}));
vi.mock("@/lib/local/git", () => ({
  runGit: vi.fn(async (_dir: string, args: readonly string[]) => {
    if (args[0] === "rev-list") return { ok: true, stdout: "1", stderr: "" };
    if (args[0] === "status") return { ok: true, stdout: "", stderr: "" };
    if (args[0] === "diff") return { ok: true, stdout: "src/app.ts", stderr: "" };
    return { ok: true, stdout: "sha_head", stderr: "" };
  }),
}));
vi.mock("@/lib/db", () => ({ persistScanReport: vi.fn(async () => ({ scanId: "s" })), getLatestPlatformSignals: vi.fn(async () => null) }));
vi.mock("@/lib/db/org-insights", () => ({ getOrgBacklog: vi.fn(async () => null) }));
vi.mock("@/lib/scan", () => ({ scanRepository: vi.fn(async () => ({})) }));
vi.mock("@/lib/local/source", () => ({ LocalFsSource: class {}, isWorkingCopyDirty: vi.fn(async () => false) }));
vi.mock("@/lib/local/agent", () => ({ runClaudeAgent: vi.fn(async () => ({ ok: true, summary: "did things" })) }));
vi.mock("@/lib/local/lane-cost", () => ({ recordAgentCost: vi.fn(async () => {}), excludeLaneReport: vi.fn(async () => {}) }));
vi.mock("@/lib/local/lane-guard", () => ({
  verifyBaseline: vi.fn(async () => ({ resolved: null, passed: null, note: null, narrowedFrom: null, triedNarrowed: [] })),
  verifyResult: vi.fn(async () => ({ verdict: "verified", command: "npm test", rung: "primary", note: "Verified.", reject: false })),
  verifyRejectionLesson: () => "lesson",
  forgetVerifyBaseline: vi.fn(),
  NO_VERIFY_BASELINE: { resolved: null, passed: null, note: null, narrowedFrom: null, triedNarrowed: [] },
}));

import { runLane, type LaneDeps } from "@/lib/local/loop-lane";
import { DEFAULT_LOCAL_AGENT_CONTEXT, DEFAULT_LOCAL_AGENT_TOKEN, LOCAL_AGENT_URL_ENV } from "@/lib/local/endpoint";
import type { LocalEndpoint } from "@/lib/local/transport/run";
import type { Arm } from "@/lib/local/arm";

const VERIFY_MS = 600_000;
const wt = { dir: "C:/tmp/wt", branch: "ascent/loop-x", pairedPath: "C:/repo" } as never;

const batchItem = (id: string) => ({
  id, repo: "o/r", title: "t", dimId: "D2", dimLabel: "Tests",
  impact: "high", effort: "low", rationale: "r", explore: [], projectedPoints: 5,
});

const LOCAL_ARM: Arm = { id: "local", label: "local", transport: "pi", model: "qwen3.8:27b" };
const SEAT_ARM: Arm = { id: "claude", label: "claude", transport: "claude", model: "sonnet" };

const runAgent = vi.fn(async () => ({ ok: true, summary: "RESOLVED: a - did it" }));
const runAgentVia = vi.fn(async () => ({ ok: true, summary: "RESOLVED: a - did it" }));

const deps = (): Partial<LaneDeps> => ({
  runAgent: runAgent as never,
  runAgentVia: runAgentVia as never,
  gateDiff: (() => ({ void: false, reason: null, paths: [] })) as never,
  commitWork: vi.fn(async () => ({ committed: true, files: 1, resolved: ["a"], summary: "committed" })) as never,
  rescan: vi.fn(async () => ({ scanId: "scan-after", closedIds: ["a"] })),
  openBatch: vi.fn(async () => [batchItem("a")]),
  loadBrief: vi.fn(async () => null) as never,
  readReport: vi.fn(async () => null) as never,
  loadPair: vi.fn(async () => null),
  summarize: vi.fn(async (l) => l),
  priorBaselines: vi.fn(async () => []),
});

const run = (arm: Arm | null) =>
  runLane({
    runId: "run", org: "kiro", repo: "o/r", cycle: 1, worktree: wt, batch: null,
    verify: { enabled: true, timeoutMs: VERIFY_MS },
    deps: deps(),
    ...(arm ? { arm } : {}),
  });

/** The options object the executing session was spawned with. */
const execOpts = () => runAgentVia.mock.calls[0]![1] as { endpoint?: LocalEndpoint | null; model?: string };

beforeEach(() => {
  patches.length = 0;
  runAgent.mockClear();
  runAgentVia.mockClear();
  delete process.env[LOCAL_AGENT_URL_ENV];
});

describe("the executing session's endpoint", () => {
  it("a LOCAL arm spawns against the resolved endpoint, carrying the ARM'S model", async () => {
    await run(LOCAL_ARM);
    expect(runAgentVia).toHaveBeenCalledTimes(1);
    expect(runAgentVia.mock.calls[0]![0]).toBe("pi");
    expect(execOpts().endpoint).toEqual({
      baseUrl: "http://localhost:11434",
      model: "qwen3.8:27b",
      token: DEFAULT_LOCAL_AGENT_TOKEN,
      contextTokens: DEFAULT_LOCAL_AGENT_CONTEXT,
    });
  });

  it("reads the base URL from the SERVER'S environment, never from the caller", async () => {
    process.env[LOCAL_AGENT_URL_ENV] = "http://gpu-box:11434";
    await run(LOCAL_ARM);
    expect(execOpts().endpoint?.baseUrl).toBe("http://gpu-box:11434");
  });

  it("a hosted `claude` arm sends NO endpoint key at all — the subscription seat is the absence", async () => {
    await run(SEAT_ARM);
    expect(runAgentVia).toHaveBeenCalledTimes(1);
    expect(runAgentVia.mock.calls[0]![0]).toBe("claude");
    expect(execOpts()).not.toHaveProperty("endpoint");
  });

  it("an UNARMED lane never reaches the transport door, so it cannot acquire one", async () => {
    await run(null);
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(runAgentVia).not.toHaveBeenCalled();
  });
});
