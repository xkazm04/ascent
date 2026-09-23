// THE DRIVE DOOR, ASSERTED THROUGH ITS READER (challenge-2026-09-23b, local-autopilot-loop-engine#A).
//
// The drive route reads arms ONLY from `dials.arms`. The cockpit wrote them at the top of the body, and
// the old client test pinned exactly that shape, so every arm composed in the gear was silently dropped
// on "Drive to green" and on the standing runner while both tests stayed green. These tests POST what
// `driveStartInput` / `runnerStartInput` compose to the real handler (only `startDrive` mocked) and
// follow the stored dials into the run input each drive mode arms its runs with.

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
vi.mock("@/lib/local/agent", () => ({ autopilotEnabled: () => true }));
vi.mock("@/lib/authz", () => ({ requireOrgRole: vi.fn(async () => null) }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: vi.fn(async () => "octocat") }));
vi.mock("@/lib/db/drives", () => ({ SPEND_CEILING_STORABLE_MAX_MICROS: 100_000_000_000_000 }));
vi.mock("@/lib/local/loop-engine", () => ({ LOOP_CONCURRENCY_CAP: 4, LOOP_MAX_CYCLES_CAP: 5 }));
vi.mock("@/lib/local/runner-control", () => ({ resumeRunnerRepo: vi.fn() }));
vi.mock("@/lib/local/drive", () => ({
  DRIVE_MAX_RUNS_CAP: 8,
  getDrive: vi.fn(),
  listDrives: vi.fn(async () => []),
  readDrive: vi.fn(),
  resumeDrive: vi.fn(),
  startDrive: vi.fn(async () => ({ id: "drive-new" })),
  stopDrive: vi.fn(),
}));

import { POST } from "./route";
import { startDrive } from "@/lib/local/drive";
import { dialRunInput } from "@/lib/local/drive-dials";
import { runnerRunInput } from "@/lib/local/runner";
import type { DriveStatus } from "@/lib/local/drive-types";
import type { DriveDials } from "@/lib/local/runner-types";
import { driveStartInput, runnerStartInput } from "@/features/inflight/live/cockpit/startInputs";
import { newArmDraft } from "@/features/inflight/live/cockpit/arms/armDraft";
import { INITIAL_DIALS, type RunDials } from "@/features/inflight/live/cockpit/useRunDials";

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/org/local/drive", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const start = (body: object) => post({ org: "acme", action: "start", ...body });
const armed = () => vi.mocked(startDrive).mock.calls.at(-1)?.[0];
const dials = (over: Partial<RunDials> = {}): RunDials => ({ ...INITIAL_DIALS, ...over });
const status = (d: DriveDials | null): DriveStatus =>
  ({ id: "drive-r", org: "acme", maxCycles: 2, concurrency: 1, model: null, effort: null, dials: d }) as unknown as DriveStatus;

const piArm = () => ({ ...newArmDraft("pi"), model: "qwen3.8:27b", floorAck: true });
const splitSpec = { id: "split", transport: "pi", model: "qwen3.8:27b", plan: { transport: "claude", model: "sonnet" } };

beforeEach(() => vi.clearAllMocks());

describe("Drive to green, read by the drive route", () => {
  it("a 2-arm compare set reaches startDrive as dials.arms + dials.armPolicy", async () => {
    const body = driveStartInput(dials({ armPolicy: "compare", arms: [newArmDraft(), piArm()] }), ["acme/web"]);
    expect((await start(body)).status).toBe(202);
    expect(armed()?.dials?.arms).toHaveLength(2);
    expect(armed()?.dials?.armPolicy).toBe("compare");
  });

  it("dials.arms holding a split arm and no planMode arms every run with planMode 'on'", async () => {
    const res = await start({ repos: ["acme/web"], dials: { armPolicy: "single", arms: [splitSpec] } });
    expect(res.status).toBe(202);
    expect(dialRunInput(armed()!.dials)).toMatchObject({ planMode: "on", armPolicy: "single" });
  });

  it("refuses a stale client's top-level 'arms', saying they belong in dials.arms", async () => {
    const res = await start({ repos: ["acme/web"], armPolicy: "single", arms: [splitSpec] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/dials\.arms/);
    expect(startDrive).not.toHaveBeenCalled();
  });

  it("guard: a body with no dials arms startDrive with dials null, and its runs with exactly {}", async () => {
    expect((await start({ repos: ["acme/web"] })).status).toBe(202);
    expect(armed()?.dials).toBeNull();
    expect(dialRunInput(null)).toEqual({});
  });
});

describe("the standing runner, read by the drive route", () => {
  it("a pi arm reaches startDrive in dials.arms, and every runner run carries it", async () => {
    const built = runnerStartInput(dials({ arms: [piArm()] }), []);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect((await start(built.input)).status).toBe(202);
    expect(armed()?.dials?.arms?.[0]?.transport).toBe("pi");
    const run = runnerRunInput(status(armed()!.dials ?? null), ["acme/web"], "octocat");
    expect(run.arms?.[0]).toMatchObject({ transport: "pi", model: "qwen3.8:27b" });
  });

  it("guard: the runner forces planMode on, verify on and runner delivery after the dials", () => {
    const run = runnerRunInput(status({ planMode: "off", verifyMode: "off" }), ["acme/web"], null);
    expect(run).toMatchObject({ planMode: "on", verifyMode: "on", delivery: "runner" });
  });
});
