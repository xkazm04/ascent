// Guards on GET /api/org/local/autopilot. The band polls this every 4s while a job looks live, so
// a `running` row nobody is driving must not be rendered as one — the same reconcile GET /api/org/loop
// already runs, with the same liveness predicate (2026-08-26: without it a poll stopped the run it
// was watching).

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));

const gates = { selfHosted: true, autopilot: true, access: null as unknown };

vi.mock("@/lib/api/self-host", () => ({
  selfHostGuard: () => (gates.selfHosted ? null : new Response(JSON.stringify({ error: "Not found." }), { status: 404 })),
}));
vi.mock("@/lib/api/orgPlan", () => ({ dbGuard: () => null }));
vi.mock("@/lib/local/agent", () => ({ autopilotEnabled: () => gates.autopilot }));
vi.mock("@/lib/authz", () => ({
  requireOrgAccess: vi.fn(async () => gates.access),
  requireOrgRole: vi.fn(async () => null),
}));
vi.mock("@/lib/db", () => ({ getRepoLocalPath: vi.fn(async () => "/paired/acme/web") }));
vi.mock("@/lib/local/autopilot", () => ({
  MAX_CYCLES_CAP: 5,
  getAutopilotJob: vi.fn(async () => null),
  requestAutopilotStop: vi.fn(async () => false),
  startAutopilot: vi.fn(),
}));
vi.mock("@/lib/db/loop-runs", () => ({
  markStaleRunsStopped: vi.fn(async () => 0),
}));
vi.mock("@/lib/local/loop-engine", () => ({
  isLoopRunLive: vi.fn((id: string) => id === "run-live"),
}));

import { GET } from "./route";
import { markStaleRunsStopped } from "@/lib/db/loop-runs";

const get = (qs: string) => GET(new Request(`http://localhost/api/org/local/autopilot?${qs}`));

beforeEach(() => {
  vi.clearAllMocks();
  gates.selfHosted = true;
  gates.autopilot = true;
  gates.access = null;
});

describe("GET /api/org/local/autopilot", () => {
  it("404s on managed cloud — the surface does not exist there", async () => {
    gates.selfHosted = false;
    expect((await get("org=acme")).status).toBe(404);
    expect(markStaleRunsStopped).not.toHaveBeenCalled();
  });

  it("needs an org, and refuses the public funnel org", async () => {
    expect((await get("")).status).toBe(400);
    expect((await get("org=public")).status).toBe(400);
    expect(markStaleRunsStopped).not.toHaveBeenCalled();
  });

  it("propagates the access denial verbatim, without reconciling", async () => {
    gates.access = new Response(JSON.stringify({ error: "Forbidden." }), { status: 403 });
    expect((await get("org=acme")).status).toBe(403);
    expect(markStaleRunsStopped).not.toHaveBeenCalled();
  });

  it("answers { enabled, job }", async () => {
    const body = (await (await get("org=acme")).json()) as Record<string, unknown>;
    expect(body).toEqual({ enabled: true, job: null });
  });

  it("reconciles stale runs WITH the engine's liveness — a run this process drives is not stale", async () => {
    // 2026-08-26: without the predicate GET /api/org/loop stopped the run it was rendering. This
    // band is the other poll of the same rows; it has to pass the same predicate.
    await get("org=acme");
    const call = vi.mocked(markStaleRunsStopped).mock.calls.at(-1)!;
    expect(call[0]).toBe("acme");
    const isLive = call[1] as (id: string) => boolean;
    expect(isLive("run-live")).toBe(true);
    expect(isLive("run-orphan")).toBe(false);
  });
});
