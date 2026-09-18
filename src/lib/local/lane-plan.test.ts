// PLAN FIRST — the planning session end to end, with an injected fake agent (no process is ever
// spawned) over a REAL temp git repository, because the clean-tree proof is a claim about git and a
// mocked `git status` would let it pass while proving nothing.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClaudeAgentOptions, AgentRunResult } from "./agent";
import type { FollowUpItem } from "@/lib/org/followups";
import type { RecordLanePlansInput } from "@/lib/db/loop-plans-write";

const recordLanePlans = vi.fn(async (input: RecordLanePlansInput) => ({
  executingId: input.executing ? "exec-1" : null,
  parkedId: input.parked ? "park-1" : null,
}));
const reviseNotesFor = vi.fn(async (): Promise<{ id: string; intent: string; note: string; decidedBy: string | null }[]> => []);
const activeDirections = vi.fn(async (): Promise<{ id: string; fence: string[] }[]> => []);
vi.mock("@/lib/db/loop-plans-write", () => ({ recordLanePlans, reviseNotesFor }));
vi.mock("@/lib/db/loop-directions", () => ({ activeDirections }));

import { PLAN_WROTE_MESSAGE, planLane } from "./lane-plan";
import { PLAN_TIMEOUT_MS } from "./runner-types";
import { recommendationDecisionKey } from "@/lib/report/rec-identity";

const dirs: string[] = [];
let dir = "";
const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: "pipe" });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ascent-lane-plan-"));
  dirs.push(dir);
  for (const rel of ["src/lib/db/a.ts", "src/lib/local/b.ts"]) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), "export {};\n", "utf8");
  }
  git("init", "-q");
  git("config", "core.autocrlf", "false");
  git("add", "-A");
  git("-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "seed");
  recordLanePlans.mockClear();
  reviseNotesFor.mockClear().mockResolvedValue([]);
  activeDirections.mockClear().mockResolvedValue([]);
});
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const item = (id: string, title: string, dimId = "D1"): FollowUpItem => ({
  id, repo: "acme/web", title, dimId, dimLabel: dimId, impact: "high", effort: "low", rationale: "why", explore: ["q?"], projectedPoints: 2,
});
const recorded = (): RecordLanePlansInput => recordLanePlans.mock.calls[0]![0];
const BATCH = [item("rec-a", "Add retries"), item("rec-b", "Split the god module", "D2")];

const planText = (moves: Record<string, unknown[]>) =>
  "Plan follows.\n```json\n" +
  JSON.stringify({
    v: 1,
    intent: "Make fetch resilient.",
    items: BATCH.map((b) => ({ recommendationId: b.id, approach: `do ${b.id}`, files: ["src/lib/db/a.ts"], moves: moves[b.id] ?? [] })),
    modules: ["src/lib/db/"],
    check: "npm test",
    risks: [],
    notDoing: ["no rewrite"],
  }) +
  "\n```";

function run(agent: (o: ClaudeAgentOptions) => AgentRunResult | Promise<AgentRunResult>) {
  const calls: ClaudeAgentOptions[] = [];
  const runAgent = vi.fn(async (o: ClaudeAgentOptions) => {
    calls.push(o);
    return agent(o);
  });
  const outcome = planLane({
    org: "acme", repo: "acme/web", runId: "run-1", laneId: "lane-1", cycle: 1,
    worktree: { dir, branch: "ascent/loop-x", pairedPath: join(dir, "..", "paired-elsewhere"), linkedDeps: [], depNotes: [] },
    batch: BATCH, briefText: "ORG STANDARD TEXT", agent: { model: "sonnet", effort: null }, runAgent,
  });
  return { outcome, calls };
}

describe("planLane", () => {
  it("minor only: every item executes, the planning session is resumable, one executing row", async () => {
    const { outcome, calls } = run(() => ({ ok: true, summary: planText({}) }));
    const res = await outcome;
    const call = calls[0]!;
    expect(call).toMatchObject({ cwd: dir, permission: "plan", timeoutMs: PLAN_TIMEOUT_MS, model: "sonnet" });
    expect(call.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(call.prompt).toContain("ORG STANDARD TEXT");
    expect(call.prompt).toContain("- src/lib/local/");
    expect(call.prompt).toContain("An UNDECLARED move is detected from the real diff");
    if (res.mode !== "execute") throw new Error(res.mode);
    expect(res.execute.map((i) => i.id)).toEqual(["rec-a", "rec-b"]);
    expect(res).toMatchObject({ parked: [], planId: "exec-1", resumeSessionId: call.sessionId, declaredMoves: [], directionFence: null });
    expect(res.planBlock).toContain("YOUR PLAN — this is the fixed tier");
    expect(res.planBlock).toContain("THE FENCE IS ENFORCED");
    const input = recorded();
    expect(input.executing).toMatchObject({
      cls: "minor", clsReason: "no-moves", directionId: null, recIds: ["rec-a", "rec-b"], titles: ["Add retries", "Split the god module"],
      keys: [recommendationDecisionKey("acme/web", "D1", "Add retries"), recommendationDecisionKey("acme/web", "D2", "Split the god module")],
    });
    expect(input).toMatchObject({ parked: null, sessionId: call.sessionId, runId: "run-1", laneId: "lane-1" });
    expect(input.partition.source).toBe("directory");
  });

  it("mixed: the item with an architecture move is parked as ONE pending major plan", async () => {
    const move = { kind: "cross-module-move", from: "src/lib/db/", to: "src/lib/local/" };
    const res = await run(() => ({ ok: true, summary: planText({ "rec-b": [move] }) })).outcome;
    if (res.mode !== "execute") throw new Error(res.mode);
    expect(res.execute.map((i) => i.id)).toEqual(["rec-a"]);
    expect(res.parked.map((i) => i.id)).toEqual(["rec-b"]);
    expect(res.planBlock).toContain("`rec-a`");
    expect(res.planBlock).not.toContain("`rec-b`");
    const input = recorded();
    expect(input.parked).toMatchObject({ cls: "major", clsReason: "declared-moves", recIds: ["rec-b"] });
    expect(input.parked!.plan!.items.map((i) => i.recommendationId)).toEqual(["rec-b"]);
  });

  it("under an active direction whose fence holds the move, the item executes under it", async () => {
    activeDirections.mockResolvedValue([{ id: "dir-1", fence: ["src/lib/"] }]);
    const move = { kind: "cross-module-move", from: "src/lib/db/", to: "src/lib/local/" };
    const res = await run(() => ({ ok: true, summary: planText({ "rec-b": [move] }) })).outcome;
    if (res.mode !== "execute") throw new Error(res.mode);
    expect(res).toMatchObject({ parked: [], directionFence: ["src/lib/"], declaredMoves: [move] });
    expect(recorded().executing).toMatchObject({ cls: "minor-under-direction", clsReason: "inside-direction-fence", directionId: "dir-1" });
  });

  it("unreadable: every item parks as major-unreadable and nothing is resumable", async () => {
    const res = await run(() => ({ ok: true, summary: "I looked around but here is no json." })).outcome;
    if (res.mode !== "execute") throw new Error(res.mode);
    expect(res).toMatchObject({ execute: [], planBlock: "", resumeSessionId: null, planId: null });
    expect(res.parked).toHaveLength(2);
    const input = recorded();
    expect(input.executing).toBeNull();
    expect(input.parked).toMatchObject({ cls: "major", clsReason: "unreadable", plan: null });
  });

  it("a session that WROTE to the worktree fails the lane and the throwaway tree is restored", async () => {
    const res = await run(() => {
      writeFileSync(join(dir, "src/lib/db/a.ts"), "tampered\n", "utf8");
      writeFileSync(join(dir, "stray.txt"), "x", "utf8");
      return { ok: true, summary: planText({}) };
    }).outcome;
    expect(res).toEqual({ mode: "failed", message: PLAN_WROTE_MESSAGE });
    expect(recordLanePlans).not.toHaveBeenCalled();
    expect(git("status", "--porcelain").trim()).toBe("");
    expect(readFileSync(join(dir, "src/lib/db/a.ts"), "utf8")).toBe("export {};\n");
    expect(existsSync(join(dir, "stray.txt"))).toBe(false);
  });

  it("a session that COMMITTED (clean tree, moved HEAD) fails too, and HEAD goes back", async () => {
    const head = git("rev-parse", "HEAD").trim();
    const res = await run(() => {
      writeFileSync(join(dir, "src/lib/db/a.ts"), "committed", "utf8");
      git("-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", "commit", "-qam", "sneaky");
      return { ok: true, summary: planText({}) };
    }).outcome;
    expect(res).toEqual({ mode: "failed", message: PLAN_WROTE_MESSAGE });
    expect(git("rev-parse", "HEAD").trim()).toBe(head);
  });

  it("a failed session with no plan fails the lane with the agent's first line", async () => {
    const res = await run(() => ({ ok: false, summary: "\nAgent session exceeded 8 min and was stopped.\ntrace", errorText: null })).outcome;
    expect(res).toEqual({ mode: "failed", message: "The planning session failed: Agent session exceeded 8 min and was stopped." });
    expect(recordLanePlans).not.toHaveBeenCalled();
  });

  it("revision notes reach the planner, and the revise plans they answer are superseded", async () => {
    reviseNotesFor.mockResolvedValue([{ id: "old-plan", intent: "Move db into local", note: "Keep db where it is.", decidedBy: "kaz" }]);
    const { outcome, calls } = run(() => ({ ok: true, summary: planText({}) }));
    await outcome;
    expect(calls[0]!.prompt).toContain("Revision asked by kaz: Keep db where it is.");
    expect(recorded().supersede).toEqual(["old-plan"]);
  });

  it("a plan that cannot be recorded fails the lane rather than running unrecorded", async () => {
    recordLanePlans.mockRejectedValueOnce(new Error("db down"));
    const res = await run(() => ({ ok: true, summary: planText({}) })).outcome;
    expect(res).toEqual({ mode: "failed", message: "The plan could not be recorded (db down); nothing was executed." });
  });
});
