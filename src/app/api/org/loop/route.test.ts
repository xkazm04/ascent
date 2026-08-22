// Guards on the loop control routes. Every one of these is the difference between a local-mode
// surface and a remote-code-execution endpoint, so they are pinned individually:
//
//   • selfHostGuard first — on managed cloud the surface answers 404, never 403 (a 403 advertises it);
//   • reads take requireOrgAccess, writes take requireOrgRole("owner") — starting a run spawns editing
//     agents inside paired working copies, the same blast radius as pairing itself;
//   • the public funnel org is refused outright;
//   • ASCENT_AUTOPILOT=1 is checked at the ROUTE, so a disabled deployment answers an honest 409 with
//     the fix instead of arming a run whose first agent call refuses;
//   • TENANCY: `stop` / `retry` / the detail GET name a run or lane by id, and the id is re-checked
//     against the org the caller was authorized for — otherwise an owner of A could stop B's run.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));

const gates = { selfHosted: true, autopilot: true, access: null as unknown, role: null as unknown };

vi.mock("@/lib/api/self-host", () => ({
  selfHostGuard: () => (gates.selfHosted ? null : new Response(JSON.stringify({ error: "Not found." }), { status: 404 })),
}));
vi.mock("@/lib/api/orgPlan", () => ({ dbGuard: () => null }));
vi.mock("@/lib/local/agent", () => ({ autopilotEnabled: () => gates.autopilot }));
vi.mock("@/lib/authz", () => ({
  requireOrgAccess: vi.fn(async () => gates.access),
  requireOrgRole: vi.fn(async () => gates.role),
}));
vi.mock("@/lib/access", () => ({ getViewer: vi.fn(async () => ({ login: "kazimi66" })) }));
vi.mock("@/lib/db/loop-tenancy", () => ({ orgIdForSlug: vi.fn(async (slug: string) => (slug === "acme" ? "org-acme" : "org-other")) }));
vi.mock("@/lib/db/loop-runs", () => ({
  LOOP_CONCURRENCY_CAP: 4,
  LOOP_MAX_CYCLES_CAP: 5,
  getActiveLoopRun: vi.fn(async () => null),
  listLoopRuns: vi.fn(async () => []),
  markStaleRunsStopped: vi.fn(async () => 0),
  getLoopRun: vi.fn(async (id: string) => (id === "run-acme" ? { id, orgId: "org-acme", endedAt: null } : id === "run-other" ? { id, orgId: "org-other" } : null)),
  getLane: vi.fn(async (id: string) => (id === "lane-acme" ? { id, runId: "run-acme" } : id === "lane-other" ? { id, runId: "run-other" } : null)),
  getLoopRunDetail: vi.fn(async (id: string) => (id === "run-acme" ? { run: { id, orgId: "org-acme" }, lanes: [], outcomes: [] } : null)),
}));
vi.mock("@/lib/local/loop-engine", () => ({
  startLoopRun: vi.fn(async () => ({ id: "run-new", phase: "running", repos: ["acme/web"] })),
  stopLoopRun: vi.fn(async () => true),
  retryLane: vi.fn(async () => true),
}));

import { GET, POST } from "./route";
import { GET as DETAIL } from "./[id]/route";
import { startLoopRun } from "@/lib/local/loop-engine";

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/org/loop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const get = (qs: string) => GET(new Request(`http://localhost/api/org/loop?${qs}`));
const detail = (id: string, qs: string) => DETAIL(new Request(`http://localhost/api/org/loop/${id}?${qs}`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  gates.selfHosted = true;
  gates.autopilot = true;
  gates.access = null;
  gates.role = null;
});

describe("the self-host guard runs first", () => {
  it("404s the GET, the POST and the detail route on managed cloud", async () => {
    gates.selfHosted = false;
    expect((await get("org=acme")).status).toBe(404);
    expect((await post({ action: "start", org: "acme", repos: ["acme/web"] })).status).toBe(404);
    expect((await detail("run-acme", "org=acme")).status).toBe(404);
  });
});

describe("GET /api/org/loop", () => {
  it("needs an org, and refuses the public funnel org", async () => {
    expect((await get("")).status).toBe(400);
    expect((await get("org=public")).status).toBe(400);
  });

  it("propagates the access denial verbatim", async () => {
    gates.access = new Response(JSON.stringify({ error: "Forbidden." }), { status: 403 });
    expect((await get("org=acme")).status).toBe(403);
  });

  it("answers { enabled, active, runs }", async () => {
    const body = (await (await get("org=acme")).json()) as Record<string, unknown>;
    expect(body).toEqual({ enabled: true, active: null, runs: [] });
  });
});

describe("POST /api/org/loop — writes are owner-gated", () => {
  it("propagates the owner denial", async () => {
    gates.role = new Response(JSON.stringify({ error: "Owner only." }), { status: 403 });
    expect((await post({ action: "start", org: "acme", repos: ["acme/web"] })).status).toBe(403);
    expect((await post({ action: "stop", org: "acme", id: "run-acme" })).status).toBe(403);
  });

  it("rejects a missing or unknown action", async () => {
    expect((await post({ org: "acme" })).status).toBe(400);
    expect((await post({ org: "acme", action: "detonate" })).status).toBe(400);
  });

  it("refuses the public funnel org", async () => {
    expect((await post({ action: "start", org: "public", repos: ["a/b"] })).status).toBe(403);
  });
});

describe("POST { action: 'start' }", () => {
  it("409s with the fix when ASCENT_AUTOPILOT is off", async () => {
    gates.autopilot = false;
    const res = await post({ action: "start", org: "acme", repos: ["acme/web"] });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/ASCENT_AUTOPILOT=1/);
  });

  it("needs a non-empty repo set", async () => {
    expect((await post({ action: "start", org: "acme", repos: [] })).status).toBe(400);
    expect((await post({ action: "start", org: "acme" })).status).toBe(400);
  });

  it("bounds maxCycles and concurrency", async () => {
    expect((await post({ action: "start", org: "acme", repos: ["a/b"], maxCycles: 9 })).status).toBe(400);
    expect((await post({ action: "start", org: "acme", repos: ["a/b"], maxCycles: 0 })).status).toBe(400);
    expect((await post({ action: "start", org: "acme", repos: ["a/b"], concurrency: 9 })).status).toBe(400);
  });

  it("passes the curated batches and the actor through, and answers { run }", async () => {
    const res = await post({
      action: "start",
      org: "acme",
      repos: ["acme/web"],
      batches: { "acme/web": ["rec1", 7, "rec2"] },
      curated: true,
      concurrency: 3,
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { run: { id: string } }).run.id).toBe("run-new");
    expect(vi.mocked(startLoopRun).mock.calls[0]![0]).toMatchObject({
      org: "acme",
      repos: ["acme/web"],
      batches: { "acme/web": ["rec1", "rec2"] }, // non-strings dropped at the edge
      curated: true,
      concurrency: 3,
      actor: "kazimi66",
    });
  });

  it("turns an engine refusal into a 409 carrying its reason", async () => {
    vi.mocked(startLoopRun).mockRejectedValueOnce(new Error("acme/web is not paired with a local path"));
    const res = await post({ action: "start", org: "acme", repos: ["acme/web"] });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/not paired/);
  });
});

describe("tenancy — an id from another org is a 404, not an action", () => {
  it("stop refuses a run the org does not own", async () => {
    expect((await post({ action: "stop", org: "acme", id: "run-other" })).status).toBe(404);
    expect((await post({ action: "stop", org: "acme", id: "nope" })).status).toBe(404);
    expect((await post({ action: "stop", org: "acme" })).status).toBe(400);
    expect((await post({ action: "stop", org: "acme", id: "run-acme" })).status).toBe(200);
  });

  it("retry refuses a lane whose run belongs to another org", async () => {
    expect((await post({ action: "retry", org: "acme", laneId: "lane-other" })).status).toBe(404);
    expect((await post({ action: "retry", org: "acme", laneId: "nope" })).status).toBe(404);
    expect((await post({ action: "retry", org: "acme" })).status).toBe(400);
    expect((await post({ action: "retry", org: "acme", laneId: "lane-acme" })).status).toBe(200);
  });

  it("the detail route refuses a run from another org and requires an org", async () => {
    expect((await detail("run-acme", "")).status).toBe(400);
    expect((await detail("run-acme", "org=other")).status).toBe(404);
    expect((await detail("missing", "org=acme")).status).toBe(404);
    expect((await detail("run-acme", "org=acme")).status).toBe(200);
  });
});
