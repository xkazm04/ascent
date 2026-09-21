// GET /api/org/loop/needs-you — the org gate first (a non-member reads nothing), the reads constrained
// by that org, pending plans only, and the pure assembly's answer.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init) },
}));
const gate = vi.hoisted(() => ({ denied: null as Response | null, db: true }));
vi.mock("@/lib/authz", () => ({ requireOrgAccess: vi.fn(async () => gate.denied) }));
vi.mock("@/lib/api/orgPlan", () => ({
  dbGuard: () => (gate.db ? null : new Response(JSON.stringify({ error: "no db" }), { status: 503 })),
}));
vi.mock("@/lib/db/loop-plans", () => ({
  listLoopPlans: vi.fn(async () => [
    { id: "plan-1", repo: "acme/web", status: "pending", plan: { intent: "Split the api module", items: [] }, planText: "", createdAt: "2026-09-18T10:00:00Z" },
  ]),
}));
vi.mock("@/lib/db/drives", () => ({
  listDriveRows: vi.fn(async () => [
    { id: "d", org: "acme", phase: "paused", mode: "continuous", pausedReason: "session-limit", pausedUntil: "2026-09-18T15:00:00Z", repoState: [{ repo: "acme/kp", paused: "repo-failures", note: "3 lanes failed" }] },
  ]),
}));

import { GET } from "./route";
import { requireOrgAccess } from "@/lib/authz";
import { listLoopPlans } from "@/lib/db/loop-plans";
import { listDriveRows } from "@/lib/db/drives";

const get = (qs: string) => GET(new Request(`http://localhost/api/org/loop/needs-you${qs}`));

beforeEach(() => {
  vi.clearAllMocks();
  gate.denied = null;
  gate.db = true;
});

describe("GET /api/org/loop/needs-you", () => {
  it("gates the org BEFORE reading anything, and returns the gate's answer", async () => {
    gate.denied = new Response(JSON.stringify({ error: "You don't have access to this organization." }), { status: 403 });
    const res = await get("?org=other");
    expect(res.status).toBe(403);
    expect(requireOrgAccess).toHaveBeenCalledWith("other");
    expect(listLoopPlans).not.toHaveBeenCalled();
    expect(listDriveRows).not.toHaveBeenCalled();
  });

  it("400 without an org", async () => {
    expect((await get("")).status).toBe(400);
    expect(requireOrgAccess).not.toHaveBeenCalled();
  });

  it("503 on a deployment with no database, after the gate", async () => {
    gate.db = false;
    expect((await get("?org=acme")).status).toBe(503);
  });

  it("reads pending plans and the org's drives — both constrained by the gated org — and assembles NeedsYou", async () => {
    const res = await get("?org=acme");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(listLoopPlans).toHaveBeenCalledWith("acme", { status: ["pending"] });
    expect(vi.mocked(listDriveRows).mock.calls[0]![0]).toBe("acme");
    expect(await res.json()).toEqual({
      runner: true,
      plans: [{ id: "plan-1", repo: "acme/web", title: "Split the api module", createdAt: "2026-09-18T10:00:00Z" }],
      pausedRepos: [{ repo: "acme/kp", reason: "repo-failures", note: "3 lanes failed" }],
      runnerPaused: { reason: "session-limit", until: "2026-09-18T15:00:00Z" },
    });
  });
});
