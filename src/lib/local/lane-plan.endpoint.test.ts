// THE PLANNING SESSION'S ENDPOINT (spark local-model-lanes, WP11).
//
// The executing half is resolved in `loop-lane.ts`; the planning half is resolved HERE, at the door
// it actually spawns through. That separation is the whole reason "Claude plans, a local model
// executes" is expressible at all — one answer reused for both sessions collapses the split arm into
// a pure-local one and records the result under the wrong name.
//
// A REAL temp git repository, like `lane-plan.test.ts` beside it: the clean-tree proof is a claim
// about git, and a mocked `git status` would let the planning session pass while proving nothing.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RecordLanePlansInput } from "@/lib/db/loop-plans-write";
import type { Arm, TransportId } from "./arm";
import type { FollowUpItem } from "@/lib/org/followups";
import type { TransportRunOptions } from "./transport/run";

const recordLanePlans = vi.fn(async (input: RecordLanePlansInput) => ({
  executingId: input.executing ? "exec-1" : null,
  parkedId: input.parked ? "park-1" : null,
}));
vi.mock("@/lib/db/loop-plans-write", () => ({ recordLanePlans, reviseNotesFor: vi.fn(async () => []) }));
vi.mock("@/lib/db/loop-directions", () => ({ activeDirections: vi.fn(async () => []) }));

import { planLane } from "./lane-plan";
import { DEFAULT_LOCAL_AGENT_CONTEXT, DEFAULT_LOCAL_AGENT_TOKEN, LOCAL_AGENT_URL_ENV } from "./endpoint";

const dirs: string[] = [];
let dir = "";
const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: "pipe" });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ascent-plan-endpoint-"));
  dirs.push(dir);
  mkdirSync(join(dir, "src/lib/db"), { recursive: true });
  writeFileSync(join(dir, "src/lib/db/a.ts"), "export {};\n", "utf8");
  git("init", "-q");
  git("config", "core.autocrlf", "false");
  git("add", "-A");
  git("-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "seed");
  recordLanePlans.mockClear();
  delete process.env[LOCAL_AGENT_URL_ENV];
});
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const item = (id: string): FollowUpItem => ({
  id, repo: "acme/web", title: "Add retries", dimId: "D1", dimLabel: "D1",
  impact: "high", effort: "low", rationale: "why", explore: ["q?"], projectedPoints: 2,
});
const BATCH = [item("rec-a")];

const planText =
  "Plan follows.\n```json\n" +
  JSON.stringify({
    v: 1,
    intent: "Make fetch resilient.",
    items: BATCH.map((b) => ({ recommendationId: b.id, approach: "do it", files: ["src/lib/db/a.ts"], moves: [] })),
    modules: ["src/lib/db/"],
    check: "npm test",
    risks: [],
    notDoing: [],
  }) +
  "\n```";

function armed(arm: Arm) {
  const via: { transport: TransportId; opts: TransportRunOptions }[] = [];
  const runVia = vi.fn(async (transport: TransportId, opts: TransportRunOptions) => {
    via.push({ transport, opts });
    return { ok: true, summary: planText };
  });
  const outcome = planLane({
    org: "acme", repo: "acme/web", runId: "run-1", laneId: "lane-1", cycle: 1,
    worktree: { dir, branch: "ascent/loop-x", pairedPath: join(dir, "..", "elsewhere"), linkedDeps: [], depNotes: [] },
    batch: BATCH, briefText: null, agent: { model: "sonnet", effort: null },
    runAgent: vi.fn(async () => ({ ok: true, summary: planText })),
    arm,
    runVia: runVia as never,
  });
  return { outcome, via };
}

const SPLIT: Arm = { id: "split", label: "split", transport: "pi", model: "qwen3.8:27b", plan: { transport: "claude", model: "sonnet" } };
const LOCAL: Arm = { id: "local", label: "local", transport: "pi", model: "qwen3.8:27b" };

describe("the planning session's endpoint", () => {
  it("a SPLIT arm whose PLANNER is Claude on the seat sends no endpoint", async () => {
    const { outcome, via } = armed(SPLIT);
    await outcome;
    expect(via).toHaveLength(1);
    expect(via[0]!.transport).toBe("claude");
    // Not "endpoint: null" — the key is absent, so the pre-arms options object is untouched.
    expect(via[0]!.opts).not.toHaveProperty("endpoint");
  });

  it("an UNSPLIT local arm plans against the resolved endpoint, with the PLANNING model on it", async () => {
    const { outcome, via } = armed(LOCAL);
    await outcome;
    expect(via[0]!.transport).toBe("pi");
    expect(via[0]!.opts.endpoint).toEqual({
      baseUrl: "http://localhost:11434",
      model: "qwen3.8:27b",
      token: DEFAULT_LOCAL_AGENT_TOKEN,
      contextTokens: DEFAULT_LOCAL_AGENT_CONTEXT,
    });
  });

  it("a SPLIT arm whose PLANNER is local resolves an endpoint for the PLANNER'S model", async () => {
    // The mirror image of the headline configuration, and the case that proves the two halves are
    // resolved independently rather than one answer being reused.
    const mirrored: Arm = { id: "m", label: "m", transport: "claude", model: "sonnet", plan: { transport: "pi", model: "llama3.3:70b" } };
    const { outcome, via } = armed(mirrored);
    await outcome;
    expect(via[0]!.transport).toBe("pi");
    expect(via[0]!.opts.endpoint?.model).toBe("llama3.3:70b");
  });

  it("takes the base URL from the SERVER'S environment", async () => {
    process.env[LOCAL_AGENT_URL_ENV] = "http://gpu-box:11434";
    const { outcome, via } = armed(LOCAL);
    await outcome;
    expect(via[0]!.opts.endpoint?.baseUrl).toBe("http://gpu-box:11434");
  });
});
