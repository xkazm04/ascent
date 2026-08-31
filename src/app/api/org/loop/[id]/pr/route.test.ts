// The gate stack on the one loop action whose effect leaves the machine. Every case here is the
// difference between "an owner published a branch" and "anyone could publish anyone's branch".

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));

const gates = { selfHosted: true, sameOrigin: true, role: null as unknown };
vi.mock("@/lib/api/self-host", () => ({
  selfHostGuard: () => (gates.selfHosted ? null : new Response(JSON.stringify({ error: "Not found." }), { status: 404 })),
}));
vi.mock("@/lib/api/orgPlan", () => ({ dbGuard: () => null }));
vi.mock("@/lib/auth", () => ({
  PUBLIC_ORG: "public",
  requireSameOrigin: () => (gates.sameOrigin ? null : new Response(JSON.stringify({ error: "Cross-origin." }), { status: 403 })),
}));
vi.mock("@/lib/access", () => ({ getViewer: vi.fn(async () => ({ login: "kazimi66" })) }));
vi.mock("@/lib/authz", () => ({ requireOrgRole: vi.fn(async () => gates.role) }));
vi.mock("@/lib/db/loop-tenancy", () => ({ orgIdForSlug: vi.fn(async (slug: string) => (slug === "acme" ? "org-acme" : "org-other")) }));

const lane = {
  id: "lane-acme",
  runId: "run-acme",
  repoFullName: "acme/web",
  phase: "done",
  branch: "ascent/loop-x",
  commits: 3,
  dimId: "D3",
};
const state = { lane: { ...lane } as Record<string, unknown> };

vi.mock("@/lib/db/loop-runs", () => ({
  getLoopRun: vi.fn(async (id: string) =>
    id === "run-acme" ? { id, orgId: "org-acme" } : id === "run-other" ? { id, orgId: "org-other" } : null,
  ),
  getLane: vi.fn(async (id: string) => (id === state.lane.id ? state.lane : null)),
}));

const audits: { action: string; meta: Record<string, unknown> }[] = [];
const paired = { path: "C:/paired/web" as string | null };
vi.mock("@/lib/db", () => ({
  getRepoLocalPath: vi.fn(async () => paired.path),
  recordAudit: vi.fn(async (action: string, meta: Record<string, unknown>) => {
    audits.push({ action, meta });
    return true;
  }),
}));

const opener = { throws: null as unknown };
vi.mock("@/lib/local/loop-pr", () => ({
  openPrForLane: vi.fn(async () => {
    if (opener.throws) throw opener.throws;
    return { prNumber: 7, prUrl: "https://github.com/acme/web/pull/7", reused: false };
  }),
}));

import { AppApiError } from "@/lib/github/app";
import { POST } from "./route";
import { openPrForLane } from "@/lib/local/loop-pr";

const post = (id: string, body: unknown) =>
  POST(
    new Request(`http://localhost/api/org/loop/${id}/pr`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

const ok = { org: "acme", laneId: "lane-acme", confirm: "acme/web" };

beforeEach(() => {
  gates.selfHosted = true;
  gates.sameOrigin = true;
  gates.role = null;
  state.lane = { ...lane };
  paired.path = "C:/paired/web";
  opener.throws = null;
  audits.length = 0;
  vi.mocked(openPrForLane).mockClear();
});

describe("gates", () => {
  it("404s on managed cloud — the surface does not exist there", async () => {
    gates.selfHosted = false;
    expect((await post("run-acme", ok)).status).toBe(404);
    expect(openPrForLane).not.toHaveBeenCalled();
  });

  it("403s a cross-origin request before anything is pushed", async () => {
    gates.sameOrigin = false;
    expect((await post("run-acme", ok)).status).toBe(403);
    expect(openPrForLane).not.toHaveBeenCalled();
  });

  it("takes org-OWNER, not member — pushing into a real repo is owner-shaped", async () => {
    gates.role = new Response(JSON.stringify({ error: "Forbidden." }), { status: 403 });
    expect((await post("run-acme", ok)).status).toBe(403);
    expect(openPrForLane).not.toHaveBeenCalled();
  });
});

describe("tenancy — gate-then-constrain on both hops", () => {
  it("404s a run belonging to another org", async () => {
    expect((await post("run-other", { ...ok, laneId: "lane-acme" })).status).toBe(404);
    expect(openPrForLane).not.toHaveBeenCalled();
  });

  it("404s a lane that does not belong to the named run", async () => {
    state.lane = { ...lane, runId: "run-other" };
    expect((await post("run-acme", ok)).status).toBe(404);
    expect(openPrForLane).not.toHaveBeenCalled();
  });
});

describe("the typed confirmation", () => {
  it("400s a wrong or missing confirm, and pushes nothing", async () => {
    expect((await post("run-acme", { ...ok, confirm: "acme/other" })).status).toBe(400);
    expect((await post("run-acme", { org: "acme", laneId: "lane-acme" })).status).toBe(400);
    expect(openPrForLane).not.toHaveBeenCalled();
  });

  it("names the repo the operator has to type", async () => {
    const body = await (await post("run-acme", { ...ok, confirm: "" })).json();
    expect(body.error).toContain("acme/web");
  });
});

describe("the 409 matrix", () => {
  it("refuses a lane that has not finished, has no branch, or committed nothing", async () => {
    for (const patch of [{ phase: "running" }, { branch: null }, { commits: 0 }]) {
      state.lane = { ...lane, ...patch };
      expect((await post("run-acme", ok)).status).toBe(409);
    }
    expect(openPrForLane).not.toHaveBeenCalled();
  });

  it("refuses a lane the degradation guard REJECTED, and says why", async () => {
    // The unattended delivery step refuses one too (`loop-delivery.ts`). A verdict that only bound
    // the automatic path would be no verdict at all: a human clicking this button is exactly how a
    // reversed cycle would otherwise reach a remote everyone can see.
    state.lane = { ...lane, verifyVerdict: "rejected" };
    const res = await post("run-acme", ok);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/degradation guard/i);
    expect(openPrForLane).not.toHaveBeenCalled();
  });

  it("does NOT refuse the other three verdicts", async () => {
    for (const verdict of ["verified", "baseline-red", "skipped"]) {
      state.lane = { ...lane, verifyVerdict: verdict };
      expect((await post("run-acme", ok)).status, `${verdict} was refused`).toBe(200);
    }
  });

  it("refuses when the repo is no longer paired", async () => {
    paired.path = null;
    expect((await post("run-acme", ok)).status).toBe(409);
  });
});

describe("audit", () => {
  it("writes an audit row on success, naming the PR", async () => {
    const res = await post("run-acme", ok);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ prNumber: 7, reused: false });
    expect(audits[0]).toMatchObject({ action: "loop.pr.opened" });
    expect(audits[0]!.meta).toMatchObject({ laneId: "lane-acme", prNumber: 7, branch: "ascent/loop-x" });
  });

  it("writes an audit row on a REFUSAL too — by then the branch may already be on the remote", async () => {
    opener.throws = new AppApiError(409, "acme/web", "Could not push: non-fast-forward");
    const res = await post("run-acme", ok);
    expect(res.status).toBe(409);
    expect(audits[0]).toMatchObject({ action: "loop.pr.refused" });
    expect(String(audits[0]!.meta.reason)).toContain("non-fast-forward");
  });

  it("maps an unexpected GitHub status to 502 rather than leaking it", async () => {
    opener.throws = new AppApiError(500, "/pulls", "GitHub is having a day");
    expect((await post("run-acme", ok)).status).toBe(502);
  });
});
