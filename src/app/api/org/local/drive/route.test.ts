// The DRIVE route's guards and its standing-runner surface (spark theater-upgrade, 2026-09-18).
//
// A continuous drive spawns editing agents indefinitely, so its door is the drive's door exactly:
// self-host 404, owner, the loop flag 409. What is new and pinned here: `mode`, `spendCeilingUsd` and
// `dials` are validated rather than coerced (a runner that cannot deliver to its runner branch or
// cannot verify is a 400, not a silently different runner), the dials reach a BOUNDED drive too, and
// `resume-repo` is owner-gated like every other write.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));

const gates = { selfHosted: true, autopilot: true, role: null as unknown };

vi.mock("@/lib/api/self-host", () => ({
  selfHostGuard: () => (gates.selfHosted ? null : new Response(JSON.stringify({ error: "Not found." }), { status: 404 })),
}));
vi.mock("@/lib/api/orgPlan", () => ({ dbGuard: () => null }));
vi.mock("@/lib/github/app", () => ({ isAppConfigured: () => true }));
vi.mock("@/lib/local/agent", () => ({ autopilotEnabled: () => gates.autopilot }));
vi.mock("@/lib/authz", () => ({ requireOrgRole: vi.fn(async () => gates.role) }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: vi.fn(async () => "octocat") }));
vi.mock("@/lib/db/drives", () => ({ SPEND_CEILING_STORABLE_MAX_MICROS: 100_000_000_000_000 }));
vi.mock("@/lib/local/loop-engine", () => ({ LOOP_CONCURRENCY_CAP: 4, LOOP_MAX_CYCLES_CAP: 5 }));
vi.mock("@/lib/local/drive", () => ({
  DRIVE_MAX_RUNS_CAP: 8,
  getDrive: vi.fn(),
  listDrives: vi.fn(async () => []),
  readDrive: vi.fn(),
  resumeDrive: vi.fn(),
  startDrive: vi.fn(async (input: { mode?: string }) => ({ id: "drive-new", mode: input.mode ?? "bounded" })),
  stopDrive: vi.fn(),
}));
vi.mock("@/lib/local/runner-control", () => ({
  resumeRunnerRepo: vi.fn(async (_org: string, repo: string) =>
    repo === "acme/api" ? { ok: true, drive: { id: "drive-r" } } : { ok: false, status: 404, error: "not in scope" },
  ),
}));

import { POST } from "./route";
import { startDrive } from "@/lib/local/drive";
import { resumeRunnerRepo } from "@/lib/local/runner-control";

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/org/local/drive", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const start = (over: Record<string, unknown> = {}) => post({ org: "acme", action: "start", repos: ["acme/api"], ...over });
const lastStart = () => vi.mocked(startDrive).mock.calls.at(-1)?.[0];

beforeEach(() => {
  vi.clearAllMocks();
  gates.selfHosted = true;
  gates.autopilot = true;
  gates.role = null;
});

describe("the continuous start — the standing runner's door", () => {
  it("arms a runner: mode, runner delivery, the ceiling and the dials reach startDrive", async () => {
    const res = await start({ mode: "continuous", spendCeilingUsd: 12.5, dials: { batchSize: 8, rescanCadence: "run" }, maxRuns: 99 });
    expect(res.status).toBe(202);
    expect(lastStart()).toMatchObject({
      org: "acme",
      mode: "continuous",
      delivery: "runner",
      spendCeilingUsd: 12.5,
      dials: { batchSize: 8, rescanCadence: "run" },
      actor: "octocat",
    });
  });

  it("omitted ceiling = the default (undefined reaches startDrive); null = no ceiling", async () => {
    await start({ mode: "continuous" });
    expect(lastStart()).toHaveProperty("spendCeilingUsd", undefined);
    await start({ mode: "continuous", spendCeilingUsd: null });
    expect(lastStart()).toHaveProperty("spendCeilingUsd", null);
  });

  it("is self-hosted, owner and loop-flag gated like every drive", async () => {
    gates.selfHosted = false;
    expect((await start({ mode: "continuous" })).status).toBe(404);
    gates.selfHosted = true;
    gates.role = new Response(JSON.stringify({ error: "Forbidden." }), { status: 403 });
    expect((await start({ mode: "continuous" })).status).toBe(403);
    gates.role = null;
    gates.autopilot = false;
    expect((await start({ mode: "continuous" })).status).toBe(409);
    expect(startDrive).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown mode", { mode: "forever" }],
    ["a runner asked to land in the operator's branch", { mode: "continuous", delivery: "land" }],
    ["a bounded drive asked to deliver to the runner branch", { delivery: "runner" }],
    ["a runner whose guard is dialled off", { mode: "continuous", dials: { verifyMode: "off" } }],
    ["a batch past the cap", { dials: { batchSize: 40 } }],
    ["a non-object dials", { dials: "fast" }],
    ["an A/B policy without two models", { dials: { modelPolicy: "ab", models: ["opus"] } }],
    ["a negative ceiling", { mode: "continuous", spendCeilingUsd: -1 }],
    ["a ceiling past the $1,000,000 sanity bound", { mode: "continuous", spendCeilingUsd: 1_000_001 }],
  ])("400s %s — refused, never coerced", async (_label, body) => {
    expect((await start(body)).status).toBe(400);
    expect(startDrive).not.toHaveBeenCalled();
  });
});

describe("the bounded start keeps its shape — and now carries the dials", () => {
  it("passes the dials a bounded drive dropped before, and no runner fields", async () => {
    const res = await start({ maxRuns: 3, dials: { batchSize: 10, agentTimeoutMs: 1_800_000, verifyMode: "off", verifyTimeoutMs: 60_000 } });
    expect(res.status).toBe(202);
    const input = lastStart()!;
    expect(input.dials).toEqual({ batchSize: 10, agentTimeoutMs: 1_800_000, verifyMode: "off", verifyTimeoutMs: 60_000 });
    expect(input).not.toHaveProperty("mode");
    expect(input).not.toHaveProperty("spendCeilingUsd");
  });

  it("still bounds the rope", async () => {
    expect((await start({ maxRuns: 99 })).status).toBe(400);
  });
});

describe("resume-repo", () => {
  it("lifts a paused repo on the live runner (owner only)", async () => {
    const res = await post({ org: "acme", action: "resume-repo", repo: "acme/api" });
    expect(res.status).toBe(200);
    expect(resumeRunnerRepo).toHaveBeenCalledWith("acme", "acme/api");
    expect(((await res.json()) as { drive: { id: string } }).drive.id).toBe("drive-r");
  });

  it("400s without a repo, passes the control surface's 404 through, and is owner-gated", async () => {
    expect((await post({ org: "acme", action: "resume-repo" })).status).toBe(400);
    expect((await post({ org: "acme", action: "resume-repo", repo: "acme/other" })).status).toBe(404);
    gates.role = new Response(JSON.stringify({ error: "Forbidden." }), { status: 403 });
    expect((await post({ org: "acme", action: "resume-repo", repo: "acme/api" })).status).toBe(403);
  });
});
