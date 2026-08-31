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

const gates = { selfHosted: true, autopilot: true, githubApp: true, access: null as unknown, role: null as unknown };

vi.mock("@/lib/api/self-host", () => ({
  selfHostGuard: () => (gates.selfHosted ? null : new Response(JSON.stringify({ error: "Not found." }), { status: 404 })),
}));
vi.mock("@/lib/api/orgPlan", () => ({ dbGuard: () => null }));
// The GitHub App seam, mocked rather than env-driven: `delivery:"pr"` must be refused honestly on a
// deployment without one, and that refusal is a property of the route, not of this machine's env.
vi.mock("@/lib/github/app", () => ({ isAppConfigured: () => gates.githubApp }));
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
  getOrgPriceList: vi.fn(async () => ({ rows: [], unproductiveMicros: 0, unpricedLanes: 0, generatedAt: "2026-08-30T00:00:00.000Z" })),
  getLoopRun: vi.fn(async (id: string) => (id === "run-acme" ? { id, orgId: "org-acme", endedAt: null } : id === "run-other" ? { id, orgId: "org-other" } : null)),
  getLane: vi.fn(async (id: string) => (id === "lane-acme" ? { id, runId: "run-acme" } : id === "lane-other" ? { id, runId: "run-other" } : null)),
  reviewDeliverable: vi.fn(async (_laneId: string, cover: string, verdict: string) => [
    { headline: "Added a coverage gate to CI", dimId: "D2", kind: "closed", covers: [cover], evidence: null, review: verdict },
  ]),
  getLoopRunDetail: vi.fn(async (id: string) => (id === "run-acme" ? { run: { id, orgId: "org-acme" }, lanes: [], outcomes: [] } : null)),
}));
vi.mock("@/lib/local/loop-engine", () => ({
  startLoopRun: vi.fn(async () => ({ id: "run-new", phase: "running", repos: ["acme/web"] })),
  // #3 — the hosted half. A remote run is armed in `curating` and driven by nobody here.
  startRemoteRun: vi.fn(async () => ({ id: "run-remote", phase: "curating", repos: ["acme/web"] })),
  stopLoopRun: vi.fn(async () => true),
  retryLane: vi.fn(async () => true),
  isLoopRunLive: vi.fn((id: string) => id === "run-live"),
}));

import { GET, POST } from "./route";
import { GET as DETAIL } from "./[id]/route";
import { startLoopRun, startRemoteRun } from "@/lib/local/loop-engine";

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/org/loop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const get = (qs: string) => GET(new Request(`http://localhost/api/org/loop?${qs}`));
const detail = (id: string, qs: string) => DETAIL(new Request(`http://localhost/api/org/loop/${id}?${qs}`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  gates.selfHosted = true;
  gates.autopilot = true;
  gates.githubApp = true;
  gates.access = null;
  gates.role = null;
});

describe("the self-host guard runs first — for the executor that needs it", () => {
  it("404s a LOCAL start and the detail route on managed cloud", async () => {
    gates.selfHosted = false;
    expect((await post({ action: "start", org: "acme", repos: ["acme/web"] })).status).toBe(404);
    expect((await detail("run-acme", "org=acme")).status).toBe(404);
  });

  // MOONSHOT #3. The read is no longer self-hosted-only, because a cloud org can now arm a
  // `remote-agent` run and 404ing its own runs would hide the operator's rows from them. `enabled`
  // stays the honest answer to the question it always asked — can this deployment run a LOCAL loop.
  it("still serves the GET on managed cloud, saying the local loop is not enabled", async () => {
    gates.selfHosted = false;
    gates.autopilot = false;
    const res = await get("org=acme");
    expect(res.status).toBe(200);
    expect((await res.json()) as { enabled: boolean }).toMatchObject({ enabled: false });
  });

  it("accepts a remote-agent start with no self-hosted flag and no autopilot", async () => {
    gates.selfHosted = false;
    gates.autopilot = false;
    const res = await post({ action: "start", org: "acme", repos: ["acme/web"], executor: "remote-agent" });
    expect(res.status).toBe(200);
    expect(startRemoteRun).toHaveBeenCalledWith(expect.objectContaining({ org: "acme", repos: ["acme/web"] }));
    // And it NEVER reaches the local engine, which would spawn a process.
    expect(startLoopRun).not.toHaveBeenCalled();
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

  it("answers { enabled, active, runs, prices, prAvailable }", async () => {
    const body = (await (await get("org=acme")).json()) as Record<string, unknown>;
    // The price list rides on the STATUS read rather than a route of its own: it is derived at read
    // time from the org's own lanes and stores nothing, so it has no id to gate. `prAvailable` rides
    // along for the same reason: it is a fact about the deployment, not a resource with an id.
    expect(body).toEqual({
      enabled: true,
      active: null,
      runs: [],
      prices: { rows: [], unproductiveMicros: 0, unpricedLanes: 0, generatedAt: "2026-08-30T00:00:00.000Z" },
      prAvailable: true,
    });
  });

  it("reconciles stale runs WITH the engine's liveness — a run this process drives is not stale", async () => {
    // 2026-08-26: without the predicate this GET stopped the run it was rendering.
    const { markStaleRunsStopped } = await import("@/lib/db/loop-runs");
    await get("org=acme");
    const call = vi.mocked(markStaleRunsStopped).mock.calls.at(-1)!;
    expect(call[0]).toBe("acme");
    const isLive = call[1] as (id: string) => boolean;
    expect(isLive("run-live")).toBe(true);
    expect(isLive("run-orphan")).toBe(false);
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

  it("threads a valid A/B policy through as two arms", async () => {
    const res = await post({ action: "start", org: "acme", repos: ["acme/web"], modelPolicy: "ab", models: ["sonnet", "opus"] });
    expect(res.status).toBe(200);
    expect(vi.mocked(startLoopRun).mock.calls.at(-1)![0]).toMatchObject({ modelPolicy: "ab", models: ["sonnet", "opus"] });
  });

  it("400s an A/B run that does not name exactly two distinct models", async () => {
    // A malformed A/B request must not degrade to a single-model run: the operator would believe they
    // ran a comparison they did not.
    for (const models of [["sonnet"], ["sonnet", "sonnet"], ["a", "b", "c"], undefined]) {
      const res = await post({ action: "start", org: "acme", repos: ["acme/web"], modelPolicy: "ab", models });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/two distinct models/);
    }
  });

  it("400s an arm that is not a plain token, and never reaches the spawn seam", async () => {
    // `shell: true` re-parses argv on Windows, so an unvalidated model name is argument injection.
    const before = vi.mocked(startLoopRun).mock.calls.length;
    const res = await post({ action: "start", org: "acme", repos: ["acme/web"], modelPolicy: "ab", models: ["sonnet", "opus; rm -rf /"] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Invalid model/);
    expect(vi.mocked(startLoopRun).mock.calls.length).toBe(before);
  });

  it("leaves a single-model run with no policy fields at all", async () => {
    await post({ action: "start", org: "acme", repos: ["acme/web"] });
    expect(vi.mocked(startLoopRun).mock.calls.at(-1)![0]).not.toHaveProperty("modelPolicy");
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

  it("review refuses a lane whose run belongs to another org, validates its verdict, and skips the autopilot gate", async () => {
    expect((await post({ action: "review", org: "acme", laneId: "lane-other", cover: "rec-1", verdict: "approved" })).status).toBe(404);
    expect((await post({ action: "review", org: "acme", laneId: "lane-acme", cover: "rec-1", verdict: "detonated" })).status).toBe(400);
    expect((await post({ action: "review", org: "acme", laneId: "lane-acme", verdict: "approved" })).status).toBe(400);
    // Ruling on a past run's rows must work even when the loop itself is switched off.
    gates.autopilot = false;
    const res = await post({ action: "review", org: "acme", laneId: "lane-acme", cover: "rec-1", verdict: "dismissed" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; deliverables: { review?: string }[] };
    expect(body.ok).toBe(true);
    expect(body.deliverables[0]!.review).toBe("dismissed");
    // ...and it is owner-gated like every other write.
    gates.role = new Response(JSON.stringify({ error: "Owner only." }), { status: 403 });
    expect((await post({ action: "review", org: "acme", laneId: "lane-acme", cover: "rec-1", verdict: "approved" })).status).toBe(403);
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

// ── DELIVERY (how a lane's work reaches the operator) ───────────────────────────────────────────
//
// `branch` is the default and is what every run before this column did; `land` and `pr` are opt-ins,
// and `pr` is the one that can be genuinely unavailable. The rule under test is that an unavailable
// `pr` is REFUSED — a run armed for pull requests that quietly left branches behind would leave the
// operator believing their work was in review.

describe("delivery", () => {
  const started = () => (startLoopRun as unknown as { mock: { calls: [{ delivery?: unknown }][] } }).mock.calls[0]![0];

  it("defaults to null — recorded as `branch`, exactly what a run without the dial always did", async () => {
    expect((await post({ action: "start", org: "acme", repos: ["acme/web"] })).status).toBe(200);
    expect(started().delivery).toBeNull();
  });

  it("passes the two working-copy modes through once they are named", async () => {
    await post({ action: "start", org: "acme", repos: ["acme/web"], delivery: "land" });
    expect(started().delivery).toBe("land");
    vi.clearAllMocks();
    await post({ action: "start", org: "acme", repos: ["acme/web"], delivery: "pr" });
    expect(started().delivery).toBe("pr");
  });

  it("normalizes an unknown value to null — never a guess at a mode that writes to a checkout", async () => {
    for (const bad of ["merge", "LAND", "", 3, true, null]) {
      vi.clearAllMocks();
      expect((await post({ action: "start", org: "acme", repos: ["acme/web"], delivery: bad })).status).toBe(200);
      expect(started().delivery).toBeNull();
    }
  });

  it("REFUSES `pr` when the deployment has no GitHub App, rather than falling back to a branch", async () => {
    gates.githubApp = false;
    const res = await post({ action: "start", org: "acme", repos: ["acme/web"], delivery: "pr" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("no GitHub App");
    expect(startLoopRun).not.toHaveBeenCalled();
  });

  it("still allows branch and land without a GitHub App — landing is purely local", async () => {
    gates.githubApp = false;
    expect((await post({ action: "start", org: "acme", repos: ["acme/web"], delivery: "land" })).status).toBe(200);
    expect(started().delivery).toBe("land");
  });

  it("reports whether a PR is possible at all, so the dial can disable the mode honestly", async () => {
    expect(((await (await get("org=acme")).json()) as { prAvailable: boolean }).prAvailable).toBe(true);
    gates.githubApp = false;
    expect(((await (await get("org=acme")).json()) as { prAvailable: boolean }).prAvailable).toBe(false);
  });

  it("keeps delivery an OWNER decision, like every other write on this route", async () => {
    gates.role = new Response(JSON.stringify({ error: "Owner only." }), { status: 403 });
    expect((await post({ action: "start", org: "acme", repos: ["acme/web"], delivery: "land" })).status).toBe(403);
    expect(startLoopRun).not.toHaveBeenCalled();
  });
});
