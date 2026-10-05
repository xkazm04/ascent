// ONE GATE-REPAIR TURN (2026-10-05) — spent only when the ONLY thing voiding a lane is that the gate
// it declared does not pass on its own tree, at most once, and every outcome logged. The guard is the
// real `checkGateDiff`; the session, the commit and the evidence re-read are fakes.

import { describe, expect, it, vi } from "vitest";
import { checkGateDiff, type GateDiffOptions, type LadderRung } from "@/lib/local/lane-gate-diff";
import type { AgentRunResult } from "@/lib/local/agent";
import {
  GATE_REPAIR_TIMEOUT_MS,
  failureExcerpt,
  failingDeclaredGate,
  gateRepairBudgetMs,
  repairDeclaredGate,
  type GateRepairDeps,
  type RepairReverify,
} from "@/lib/local/lane-gate-repair";

const LINT = "node tools/lint.mjs && node apps/vr/tools/check-pin.mjs";
/** The measured shape: a no-check Unreal repo bootstraps its first gate in the manifest. */
const BOOT: { before: LadderRung[]; after: LadderRung[] } = { before: [], after: [{ command: LINT, rung: "primary" }] };
const PATHS = [".ai/manifest.yaml", "tools/lint.mjs", "apps/vr/tools/check-pin.mjs"];
const STATUSES = { ".ai/manifest.yaml": "A", "tools/lint.mjs": "A", "apps/vr/tools/check-pin.mjs": "A" };
const FAIL_OUT = "checking pins…\nFAIL apps/vr/pins.json: engine pin 5.3 does not match 5.4\n    at check-pin.mjs:12";
const failRun = (output = FAIL_OUT) => [{ command: LINT, rung: "primary" as const, ok: false, timedOut: false, output }];
const passRun = () => [{ command: LINT, rung: "primary" as const, ok: true, timedOut: false, output: "ok" }];
const skipped = { verdict: "skipped", command: null };
const evidenceWith = (runs: GateDiffOptions["declaredGateRuns"], extra: Partial<GateDiffOptions> = {}): GateDiffOptions => ({
  statuses: STATUSES,
  verifyLadder: BOOT,
  laneVerdict: skipped,
  declaredGateRuns: runs,
  ...extra,
});
const gateDiff = (paths: string[], ev: GateDiffOptions) => checkGateDiff(paths, ev);

function harness(over: Partial<GateRepairDeps> & { secondRuns?: GateDiffOptions["declaredGateRuns"] } = {}) {
  const logs: string[] = [];
  const prompts: string[] = [];
  const deps: GateRepairDeps = {
    resume: vi.fn(async (_sid: string, prompt: string): Promise<AgentRunResult> => {
      prompts.push(prompt);
      return { ok: true, summary: "Fixed the pin check to read the engine version from the .uproject." };
    }),
    commit: vi.fn(async () => ({ committed: true, summary: "committed the repair" })),
    readEvidence: vi.fn(async () => ({ changedPaths: PATHS, evidence: evidenceWith(over.secondRuns ?? passRun()) })),
    gateDiff,
    log: vi.fn(async (l: string) => {
      logs.push(l);
    }),
    ...over,
  };
  return { deps, logs, prompts };
}

const firstInput = (ev: GateDiffOptions = evidenceWith(failRun()), paths: string[] = PATHS, sessionId: string | null = "sess-1") => ({
  sessionId,
  changedPaths: paths,
  evidence: ev,
  verdict: checkGateDiff(paths, ev),
  laneVerdict: ev.laneVerdict ?? null,
});

describe("a bootstrap whose declared gate fails on the lane's tree", () => {
  it("is voided first — the precondition this module exists for", () => {
    const v = firstInput().verdict;
    expect(v.void).toBe(true);
    expect(v.reason).toContain("does not pass here");
  });

  it("gets ONE repair turn whose prompt carries the command and its first failure lines, then clears", async () => {
    const { deps, logs, prompts } = harness();
    const out = await repairDeclaredGate(firstInput(), deps);
    expect(deps.resume).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.resume).mock.calls[0]![0]).toBe("sess-1");
    expect(prompts[0]).toContain("Your declared gate does not pass on your own result");
    expect(prompts[0]).toContain("do not delete checks");
    expect(prompts[0]).toContain(`\`${LINT}\``);
    expect(prompts[0]).toContain("FAIL apps/vr/pins.json: engine pin 5.3 does not match 5.4");
    expect(deps.commit).toHaveBeenCalledWith(expect.any(String), false);
    expect(deps.readEvidence).toHaveBeenCalledWith(skipped);
    expect(out.attempted).toBe(true);
    if (!out.attempted) return;
    expect(out.verdict.void).toBe(false);
    expect(out.verdict.gateChange).toMatchObject({ from: null, to: LINT, measured: "bootstrap" });
    expect(logs[0]).toMatch(/^Gate repair: the gate this lane declared does not pass/);
    expect(logs.at(-1)).toMatch(/^Gate repair cleared the lane/);
  });

  it("still failing after the turn -> void, naming the spent turn and the SECOND failure's lines", async () => {
    const { deps, logs } = harness({ secondRuns: failRun("FAIL tools/lint.mjs: 3 problems\nline 4: no-undef") });
    const out = await repairDeclaredGate(firstInput(), deps);
    expect(deps.resume).toHaveBeenCalledTimes(1);
    if (!out.attempted) throw new Error("expected an attempt");
    expect(out.verdict.void).toBe(true);
    expect(out.verdict.reason).toContain("One gate-repair turn was spent on it");
    expect(out.verdict.reason).toContain("FAIL tools/lint.mjs: 3 problems");
    expect(logs.at(-1)).toMatch(/^Gate repair did not clear the lane: the gate still does not pass/);
  });

  it("a failed turn -> void with its reason; the residue is committed as a failed session; no re-judge", async () => {
    const { deps } = harness({ resume: vi.fn(async () => ({ ok: false, summary: "Agent session exceeded 10 min and was stopped" })) });
    const out = await repairDeclaredGate(firstInput(), deps);
    if (!out.attempted) throw new Error("expected an attempt");
    expect(out.verdict.reason).toContain("One gate-repair turn was spent on it: the repair turn failed (Agent session exceeded 10 min");
    expect(deps.commit).toHaveBeenCalledWith(expect.any(String), true);
    expect(deps.readEvidence).not.toHaveBeenCalled();
  });

  it("a turn that changed nothing -> void, never re-judged", async () => {
    const { deps } = harness({ commit: vi.fn(async () => ({ committed: false, summary: "Nothing left uncommitted in the worktree" })) });
    const out = await repairDeclaredGate(firstInput(), deps);
    if (!out.attempted) throw new Error("expected an attempt");
    expect(out.verdict.reason).toContain("left nothing committed");
    expect(deps.readEvidence).not.toHaveBeenCalled();
  });

  it("a deadline error is rethrown, not treated as a failed turn", async () => {
    const deadline = new Error("the cycle exceeded its deadline");
    const { deps } = harness({ resume: vi.fn(async () => Promise.reject(deadline)), isFatal: (e) => e === deadline });
    await expect(repairDeclaredGate(firstInput(), deps)).rejects.toBe(deadline);
  });
});

describe("a repo WITH a gate (a changed declared gate, case B)", () => {
  const CHANGE = { before: [{ command: "npm test", rung: "primary" as const }], after: [{ command: "npm run test:all", rung: "primary" as const }] };
  const verified = { verdict: "verified", command: "npm test" };
  const ev = (ok: boolean): GateDiffOptions => ({
    statuses: { "AGENTS.md": "M" },
    verifyLadder: CHANGE,
    laneVerdict: verified,
    declaredGateRuns: [{ command: "npm run test:all", rung: "primary", ok, timedOut: false, output: ok ? "" : "FAIL x.test.ts" }],
  });

  it("re-verifies against the baseline BEFORE committing, and re-judges with that verdict", async () => {
    const order: string[] = [];
    const reverify = vi.fn(async (): Promise<RepairReverify> => {
      order.push("verify");
      return { verdict: "verified", command: "npm test", reject: false, note: "Verified." };
    });
    const { deps } = harness({
      reverify,
      commit: vi.fn(async () => (order.push("commit"), { committed: true, summary: "ok" })),
      readEvidence: vi.fn(async () => ({ changedPaths: ["AGENTS.md"], evidence: ev(true) })),
    });
    const out = await repairDeclaredGate(firstInput(ev(false), ["AGENTS.md"]), deps);
    expect(order).toEqual(["verify", "commit"]);
    if (!out.attempted) throw new Error("expected an attempt");
    expect(out.verdict.void).toBe(false);
    expect(out.reverified?.verdict).toBe("verified");
  });

  it("a repair that regresses the checks -> void, nothing committed", async () => {
    const { deps } = harness({ reverify: vi.fn(async () => ({ verdict: "rejected", command: "npm test", reject: true, note: "REJECTED: 2 tests regressed" })) });
    const out = await repairDeclaredGate(firstInput(ev(false), ["AGENTS.md"]), deps);
    if (!out.attempted) throw new Error("expected an attempt");
    expect(out.verdict.reason).toContain("regressed the repository's checks (REJECTED: 2 tests regressed)");
    expect(deps.commit).not.toHaveBeenCalled();
  });
});

describe("no repair turn at all", () => {
  it.each<[string, GateDiffOptions, string[]]>([
    ["the declared gate is vacuous", evidenceWith([{ command: "echo ok", rung: "primary", ok: false, timedOut: false }], { verifyLadder: { before: [], after: [{ command: "echo ok", rung: "primary" }] } }), PATHS],
    ["the lane's verdict was reached with another command", evidenceWith(failRun(), { laneVerdict: { verdict: "verified", command: "npm test" } }), PATHS],
    ["the lane ALSO weakened a test", evidenceWith(failRun(), { statuses: { ...STATUSES, "tests/pins.test.ts": "M" } }), [...PATHS, "tests/pins.test.ts"]],
    ["the gate was never run", evidenceWith(null), PATHS],
  ])("when %s", async (_label, ev, paths) => {
    const first = firstInput(ev, paths);
    expect(first.verdict.void).toBe(true);
    const { deps, logs } = harness();
    expect(await repairDeclaredGate(first, deps)).toEqual({ attempted: false });
    expect(deps.resume).not.toHaveBeenCalled();
    expect(logs).toEqual([]);
  });

  it("without a session id to resume", async () => {
    const { deps } = harness();
    expect(await repairDeclaredGate(firstInput(undefined, PATHS, null), deps)).toEqual({ attempted: false });
    expect(deps.resume).not.toHaveBeenCalled();
  });

  it("on a lane that is not void", async () => {
    const ev = evidenceWith(passRun());
    const { deps } = harness();
    expect(await repairDeclaredGate(firstInput(ev), deps)).toEqual({ attempted: false });
  });

  it("failingDeclaredGate names the failing runs only for the failing-gate refusal", () => {
    expect(failingDeclaredGate(PATHS, evidenceWith(failRun()), gateDiff)?.map((r) => r.command)).toEqual([LINT]);
    expect(failingDeclaredGate(PATHS, evidenceWith(passRun()), gateDiff)).toBeNull();
  });
});

describe("bounds", () => {
  it("the failure excerpt stays within ~1500 characters across runs", () => {
    const huge = Array.from({ length: 400 }, (_, i) => `FAIL line ${i} ${"x".repeat(40)}`).join("\n");
    const runs = [...failRun(huge), { command: "node tools/b.mjs", rung: "lint" as const, ok: false, timedOut: true, output: huge }];
    const text = failureExcerpt(runs);
    expect(text.length).toBeLessThanOrEqual(1_500);
    expect(text).toContain("`node tools/b.mjs` (lint) timed out");
  });

  it("the turn's budget is the agent dial capped at 10 min, and null when the deadline leaves too little", () => {
    expect(gateRepairBudgetMs({ remainingMs: 3_600_000, agentTimeoutMs: 1_200_000, verifyMs: 300_000, reverify: true })).toBe(GATE_REPAIR_TIMEOUT_MS);
    expect(gateRepairBudgetMs({ remainingMs: 3_600_000, agentTimeoutMs: 240_000, verifyMs: 300_000, reverify: false })).toBe(240_000);
    expect(gateRepairBudgetMs({ remainingMs: 600_000, agentTimeoutMs: null, verifyMs: 300_000, reverify: false })).toBe(240_000);
    expect(gateRepairBudgetMs({ remainingMs: 450_000, agentTimeoutMs: null, verifyMs: 300_000, reverify: false })).toBeNull();
  });
});
