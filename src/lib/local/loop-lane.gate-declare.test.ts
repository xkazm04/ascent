// THE GATE-DECLARATION OUTCOMES AT THE CALL SITE (2026-10-05). A cleared gate change is LOGGED for the
// reviewer of the runner branch; a cleared BOOTSTRAP also upgrades the lane's `skipped` to `verified`
// in the guard's own columns, before delivery reads the row — and only `skipped` is ever upgraded.

import { beforeEach, describe, expect, it, vi } from "vitest";

const logs: string[] = [];
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
  appendLaneLog: vi.fn(async (_id: string, line: string) => {
    logs.push(line);
  }),
  getLatestScanIdForRepo: vi.fn(async () => "scan-before"),
}));
vi.mock("@/lib/db/loop-lessons", () => ({ recordLoopLessons: vi.fn(async () => []), recordRedBaselineLesson: vi.fn(async () => null) }));
vi.mock("@/lib/local/git", () => ({
  runGit: vi.fn(async (_dir: string, args: readonly string[]) => {
    if (args[0] === "rev-list") return { ok: true, stdout: "1", stderr: "" };
    if (args[0] === "status") return { ok: true, stdout: "", stderr: "" };
    if (args[0] === "diff") return { ok: true, stdout: [".ai/manifest.yaml", "CONTRIBUTING.md"].join("\n"), stderr: "" };
    return { ok: true, stdout: "sha_head", stderr: "" };
  }),
}));
vi.mock("@/lib/db", () => ({ persistScanReport: vi.fn(async () => ({ scanId: "s" })), getLatestPlatformSignals: vi.fn(async () => null) }));
vi.mock("@/lib/db/org-insights", () => ({ getOrgBacklog: vi.fn(async () => null) }));
vi.mock("@/lib/scan", () => ({ scanRepository: vi.fn(async () => ({})) }));
vi.mock("@/lib/local/source", () => ({ LocalFsSource: class {}, isWorkingCopyDirty: vi.fn(async () => false) }));
vi.mock("@/lib/local/agent", () => ({ runClaudeAgent: vi.fn(async () => ({ ok: true, summary: "did things" })) }));
vi.mock("@/lib/local/lane-cost", () => ({ recordAgentCost: vi.fn(async () => {}), excludeLaneReport: vi.fn(async () => {}) }));
const guardVerdict = vi.hoisted(() => ({ current: { verdict: "skipped", command: null as string | null, rung: null as string | null } }));
vi.mock("@/lib/local/lane-guard", () => ({
  verifyBaseline: vi.fn(async () => ({ resolved: null, passed: null, note: null, narrowedFrom: null, triedNarrowed: [] })),
  verifyResult: vi.fn(async () => ({ ...guardVerdict.current, note: "Verification SKIPPED.", reject: false })),
  verifyRejectionLesson: () => "lesson",
  forgetVerifyBaseline: vi.fn(),
  NO_VERIFY_BASELINE: { resolved: null, passed: null, note: null, narrowedFrom: null, triedNarrowed: [] },
}));

import { runLane, type LaneDeps } from "@/lib/local/loop-lane";
import type { GateChange } from "@/lib/local/lane-gate-diff";
import { unverifiedDeliveryReason } from "@/lib/local/verify-options";

const wt = { dir: "C:/tmp/wt", branch: "ascent/loop-x", pairedPath: "C:/repo" } as never;
const batchItem = { id: "a", repo: "o/r", title: "t", dimId: "D1", dimLabel: "Guidance", impact: "high", effort: "low", rationale: "r", explore: [], projectedPoints: 5 };

const BOOTSTRAP: GateChange = {
  from: null,
  to: "node apps/vr/tools/lint.mjs && gitleaks git --redact --no-banner",
  passed: "node apps/vr/tools/lint.mjs",
  rung: "lint",
  files: [".ai/manifest.yaml", "CONTRIBUTING.md"],
  measured: "bootstrap",
};
const gateDiff = vi.fn((): { void: boolean; reason: string | null; paths: string[]; gateChange?: GateChange } => ({ void: false, reason: null, paths: [] }));

const run = () =>
  runLane({
    runId: "run", org: "kiro", repo: "o/r", cycle: 1, worktree: wt, batch: null,
    agent: { timeoutMs: 60_000 },
    verify: { enabled: true, timeoutMs: 600_000 },
    deps: {
      runAgent: vi.fn(async () => ({ ok: true, summary: "RESOLVED: a - declared the gate" })) as never,
      gateDiff: gateDiff as never,
      commitWork: vi.fn(async () => ({ committed: true, files: 2, resolved: ["a"], summary: "committed" })) as never,
      rescan: vi.fn(async () => ({ scanId: "scan-after", closedIds: ["a"] })),
      openBatch: vi.fn(async () => [batchItem]),
      loadBrief: vi.fn(async () => null) as never,
      readReport: vi.fn(async () => null) as never,
      loadPair: vi.fn(async () => null),
      summarize: vi.fn(async (l) => l),
      priorBaselines: vi.fn(async () => []),
    } satisfies Partial<LaneDeps>,
  });

/** The row as delivery would read it: every patch the lane wrote, folded in order. */
const row = (): Record<string, unknown> => Object.assign({}, ...patches);

beforeEach(() => {
  logs.length = 0;
  patches.length = 0;
  guardVerdict.current = { verdict: "skipped", command: null, rung: null };
  gateDiff.mockReset();
  gateDiff.mockImplementation(() => ({ void: false, reason: null, paths: [] }));
});

describe("a cleared BOOTSTRAP at the call site", () => {
  it("upgrades `skipped` to `verified` against the declared gate, logs it, and is delivery-eligible", async () => {
    gateDiff.mockImplementation(() => ({ void: false, reason: null, paths: [], gateChange: BOOTSTRAP }));
    await run();
    const lane = row();
    expect(lane).toMatchObject({ verifyVerdict: "verified", verifyCommand: "node apps/vr/tools/lint.mjs", verifyRung: "lint" });
    expect(String(lane.verifyNote)).toMatch(/^Verified against the gate this lane DECLARED \(bootstrap\):/);
    expect(lane.phase).not.toBe("void");
    expect(lane.voidReason).toBeUndefined();
    expect(logs.some((l) => l.startsWith("Gate declared: `node apps/vr/tools/lint.mjs && gitleaks"))).toBe(true);
    // The check delivery makes under verifyMode on (loop-delivery.ts): only `verified` delivers.
    expect(unverifiedDeliveryReason(lane.verifyVerdict as string)).toBeNull();
  });

  it("without a cleared bootstrap the verdict stays `skipped` — and delivery refuses it", async () => {
    await run();
    expect(row().verifyVerdict).toBe("skipped");
    expect(unverifiedDeliveryReason("skipped")).not.toBeNull();
    expect(logs.some((l) => l.startsWith("Gate declared"))).toBe(false);
  });

  it("never upgrades a verdict that is not `skipped` (baseline-unavailable keeps its verdict)", async () => {
    guardVerdict.current = { verdict: "baseline-unavailable", command: "npm test", rung: "primary" };
    gateDiff.mockImplementation(() => ({ void: false, reason: null, paths: [], gateChange: BOOTSTRAP }));
    await run();
    expect(row().verifyVerdict).toBe("baseline-unavailable");
  });

  it("a cleared CHANGE (not a bootstrap) is logged and leaves the verdict alone", async () => {
    guardVerdict.current = { verdict: "verified", command: "npm test", rung: "primary" };
    const change: GateChange = { ...BOOTSTRAP, from: "npm test", to: "npm run test:all", passed: "npm run test:all", rung: "primary", measured: "verified" };
    gateDiff.mockImplementation(() => ({ void: false, reason: null, paths: [], gateChange: change }));
    await run();
    expect(row()).toMatchObject({ verifyVerdict: "verified", verifyCommand: "npm test" });
    expect(logs.some((l) => l.startsWith("Gate changed: `npm test` -> `npm run test:all`"))).toBe(true);
  });

  it("hands the guard the lane's own verdict and command as evidence", async () => {
    await run();
    const evidence = (gateDiff.mock.calls[0] as unknown as [string[], { laneVerdict?: unknown }])[1];
    expect(evidence.laneVerdict).toEqual({ verdict: "skipped", command: null });
  });
});
