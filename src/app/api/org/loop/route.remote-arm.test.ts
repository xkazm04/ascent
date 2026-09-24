// THE COCKPIT'S REMOTE-AGENT ARM, READ BY THE REAL ROUTE (backlog develop-2026-09-17 row 29).
//
// The hosted setup card now arms a remote-agent run. `route.test.ts` pins that the route accepts a
// hand-written remote body on cloud; this pins that the body the COCKPIT composes (`startLoopBody`) is
// that body: on a deployment where `selfHostGuard` 404s and `ASCENT_AUTOPILOT` is off, it reaches
// `startRemoteRun` with exactly the fields the remote branch reads, and a local body still 404s.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
// Managed cloud: the local surface does not exist, and the local loop is off.
vi.mock("@/lib/api/self-host", () => ({ selfHostGuard: () => new Response(JSON.stringify({ error: "Not found." }), { status: 404 }) }));
vi.mock("@/lib/api/orgPlan", () => ({ dbGuard: () => null }));
vi.mock("@/lib/github/app", () => ({ isAppConfigured: () => true }));
vi.mock("@/lib/local/agent", () => ({ autopilotEnabled: () => false, agentTimeoutMs: () => 1_200_000 }));
vi.mock("@/lib/authz", () => ({ requireOrgAccess: vi.fn(async () => null), requireOrgRole: vi.fn(async () => null) }));
vi.mock("@/lib/access", () => ({ getViewer: vi.fn(async () => ({ login: "octocat" })) }));
vi.mock("@/lib/db/loop-tenancy", () => ({ orgIdForSlug: vi.fn(async () => "org-acme") }));
vi.mock("@/lib/db/loop-runs", () => ({ LOOP_CONCURRENCY_CAP: 4, LOOP_MAX_CYCLES_CAP: 5 }));
vi.mock("@/lib/local/hosted-dispatch", () => ({ resolveHostedGate: vi.fn() }));
vi.mock("@/lib/local/loop-engine", () => ({
  startLoopRun: vi.fn(),
  startRemoteRun: vi.fn(async () => ({ id: "run-remote", phase: "curating", repos: ["acme/web"] })),
  startHostedRun: vi.fn(),
  HostedRunRefused: class extends Error {},
  stopLoopRun: vi.fn(),
  retryLane: vi.fn(),
  isLoopRunLive: vi.fn(() => false),
  loopRunStopRequested: vi.fn(() => false),
}));

import { POST } from "./route";
import { startLoopRun, startRemoteRun } from "@/lib/local/loop-engine";
import { requireOrgRole } from "@/lib/authz";
import { startLoopBody } from "@/features/inflight/live/cockpit/loopClient";

const post = (body: Record<string, unknown>) =>
  POST(new Request("http://localhost/api/org/loop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ org: "acme", ...body }) }));

beforeEach(() => vi.clearAllMocks());

describe("the cockpit's remote-agent arm on managed cloud", () => {
  it("sends exactly the fields the route's remote branch reads, and nothing a local run would", () => {
    expect(startLoopBody({ executor: "remote-agent", repos: ["acme/web"] })).toEqual({ action: "start", repos: ["acme/web"], executor: "remote-agent" });
  });

  it("is accepted with no self-hosting and no ASCENT_AUTOPILOT, and arms a remote run", async () => {
    const res = await post(startLoopBody({ executor: "remote-agent", repos: ["acme/web", "acme/api"] }));
    expect(res.status).toBe(200);
    expect(requireOrgRole).toHaveBeenCalledWith("acme", "owner");
    expect(startRemoteRun).toHaveBeenCalledWith({ org: "acme", repos: ["acme/web", "acme/api"], batches: undefined, actor: "octocat" });
    expect(startLoopRun).not.toHaveBeenCalled();
  });

  it("guard: the cockpit's LOCAL body is still a 404 on the same deployment", async () => {
    const res = await post(startLoopBody({ repos: ["acme/web"], concurrency: 1, maxCycles: 1, model: null, effort: null }));
    expect(res.status).toBe(404);
    expect(startLoopRun).not.toHaveBeenCalled();
    expect(startRemoteRun).not.toHaveBeenCalled();
  });
});
