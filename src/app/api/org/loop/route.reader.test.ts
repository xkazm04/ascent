// THE LOOP DOOR, ASSERTED THROUGH ITS READER (challenge-2026-09-23b, local-autopilot-loop-engine#A).
//
// `startInputs.test.ts` pins the body the cockpit WRITES. Nothing pinned what the route does with it,
// which is how a split arm composed in the cockpit reached the engine with `planMode: null` and never
// spawned its planning half. These tests POST the bodies the cockpit composes (and the one
// scripts/arms.mjs composes) to the real handlers, with only the engine seam mocked, and assert what
// arrives at `startLoopRun` / `startDrive`. The parity table runs one input through BOTH doors.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/api/self-host", () => ({ selfHostGuard: () => null }));
vi.mock("@/lib/api/orgPlan", () => ({ dbGuard: () => null }));
vi.mock("@/lib/github/app", () => ({ isAppConfigured: () => true }));
vi.mock("@/lib/local/agent", () => ({ autopilotEnabled: () => true, agentTimeoutMs: () => 1_200_000 }));
vi.mock("@/lib/authz", () => ({ requireOrgAccess: vi.fn(async () => null), requireOrgRole: vi.fn(async () => null) }));
vi.mock("@/lib/access", () => ({ getViewer: vi.fn(async () => ({ login: "octocat" })), resolveViewerLogin: vi.fn(async () => "octocat") }));
vi.mock("@/lib/db/loop-tenancy", () => ({ orgIdForSlug: vi.fn(async () => "org-acme") }));
vi.mock("@/lib/db/loop-runs", () => ({ LOOP_CONCURRENCY_CAP: 4, LOOP_MAX_CYCLES_CAP: 5 }));
vi.mock("@/lib/db/drives", () => ({ SPEND_CEILING_STORABLE_MAX_MICROS: 100_000_000_000_000 }));
vi.mock("@/lib/local/hosted-dispatch", () => ({ resolveHostedGate: vi.fn() }));
vi.mock("@/lib/local/runner-control", () => ({ resumeRunnerRepo: vi.fn() }));
vi.mock("@/lib/local/loop-engine", () => ({
  LOOP_CONCURRENCY_CAP: 4,
  LOOP_MAX_CYCLES_CAP: 5,
  startLoopRun: vi.fn(async () => ({ id: "run-new" })),
  startRemoteRun: vi.fn(),
  startHostedRun: vi.fn(),
  HostedRunRefused: class extends Error {},
  stopLoopRun: vi.fn(),
  retryLane: vi.fn(),
  isLoopRunLive: vi.fn(() => false),
  loopRunStopRequested: vi.fn(() => false),
}));
vi.mock("@/lib/local/drive", () => ({
  DRIVE_MAX_RUNS_CAP: 8,
  getDrive: vi.fn(),
  listDrives: vi.fn(async () => []),
  readDrive: vi.fn(),
  resumeDrive: vi.fn(),
  startDrive: vi.fn(async () => ({ id: "drive-new" })),
  stopDrive: vi.fn(),
}));

import { POST as LOOP } from "./route";
import { POST as DRIVE } from "../local/drive/route";
import { startLoopRun } from "@/lib/local/loop-engine";
import { startDrive } from "@/lib/local/drive";
import { runStartInput } from "@/features/inflight/live/cockpit/startInputs";
import { newArmDraft } from "@/features/inflight/live/cockpit/arms/armDraft";
import { INITIAL_DIALS, type RunDials } from "@/features/inflight/live/cockpit/useRunDials";

const req = (url: string, body: unknown) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const loop = (body: Record<string, unknown>) => LOOP(req("http://localhost/api/org/loop", { action: "start", org: "acme", ...body }));
const drive = (body: Record<string, unknown>) =>
  DRIVE(req("http://localhost/api/org/local/drive", { action: "start", org: "acme", repos: ["acme/web"], ...body }));
const lastRun = () => vi.mocked(startLoopRun).mock.calls.at(-1)?.[0];
const lastDrive = () => vi.mocked(startDrive).mock.calls.at(-1)?.[0];

const dials = (over: Partial<RunDials> = {}): RunDials => ({ ...INITIAL_DIALS, ...over });
/** "Claude plans, a local model executes" as the arm builder composes it. */
const splitDraft = () => ({ ...newArmDraft("pi"), model: "qwen3.8:27b", plan: { transport: "claude" as const, model: "sonnet" } });

beforeEach(() => vi.clearAllMocks());

describe("the cockpit's manual Run, read by /api/org/loop", () => {
  it("a split arm reaches startLoopRun with planMode 'on', so its planning half is spawned", async () => {
    const body = runStartInput(dials({ arms: [splitDraft()] }), { runnable: ["acme/web"], batches: {} });
    const res = await loop({ ...body });
    expect(res.status).toBe(200);
    expect(lastRun()).toMatchObject({ planMode: "on", armPolicy: "single" });
    expect(lastRun()?.arms?.[0]).toMatchObject({ transport: "pi", plan: { transport: "claude", model: "sonnet" } });
  });

  it("refuses a split arm with planMode 'off', naming planMode, and arms nothing", async () => {
    const body = runStartInput(dials({ arms: [splitDraft()] }), { runnable: ["acme/web"], batches: {} });
    const res = await loop({ ...body, planMode: "off" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/planMode/);
    expect(startLoopRun).not.toHaveBeenCalled();
  });

  it("guard: scripts/arms.mjs's body (top-level arms + planMode on) is accepted unchanged", async () => {
    const res = await loop({
      repos: ["acme/web"],
      arms: [{ id: "claude-sonnet", transport: "claude", model: "sonnet" }, { id: "split", transport: "pi", model: "qwen3.8:27b", plan: { transport: "claude", model: "sonnet" } }],
      armPolicy: "compare",
      concurrency: 2,
      maxCycles: 1,
      curated: true,
      batchSize: 2,
      planMode: "on",
    });
    expect(res.status).toBe(200);
    expect(lastRun()).toMatchObject({ armPolicy: "compare", planMode: "on", concurrency: 2, maxCycles: 1, batchSize: 2 });
    expect(lastRun()?.arms).toHaveLength(2);
  });

  it("guard: the legacy modelPolicy 'ab' pair still arms a model-keyed run with no arms", async () => {
    const res = await loop({ repos: ["acme/web"], modelPolicy: "ab", models: ["sonnet", "opus"] });
    expect(res.status).toBe(200);
    expect(lastRun()).toMatchObject({ modelPolicy: "ab", models: ["sonnet", "opus"] });
    expect(lastRun()).not.toHaveProperty("arms");
  });
});

describe("parity: one input, one verdict, whichever door it arrives at", () => {
  it.each([
    ["a sent null batchSize means omitted", { batchSize: null }, "dial", true],
    ["modelPolicy 'abc' is refused", { modelPolicy: "abc" }, "dial", false],
    ["maxCycles 2.6 is refused, never rounded or truncated", { maxCycles: 2.6 }, "top", false],
    ["a model off the roster falls back to the default", { model: "bad name" }, "top", true],
  ] as const)("%s", async (_label, fields, where, ok) => {
    const l = await loop({ repos: ["acme/web"], ...fields });
    const d = await drive(where === "top" ? { ...fields } : { dials: { ...fields } });
    expect(l.status < 300, `loop answered ${l.status}`).toBe(ok);
    expect(d.status < 300, `drive answered ${d.status}`).toBe(ok);
    if (!ok) return;
    const run = lastRun()!;
    const drv = lastDrive()!;
    expect(run.batchSize).toBeNull();
    expect(drv.dials).toBeNull();
    expect(run.model).toBe(drv.model);
    expect(run.maxCycles).toBe(drv.maxCycles);
  });
});
