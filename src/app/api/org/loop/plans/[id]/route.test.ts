// THE VERDICT ROUTE — resolve-then-gate against the PLAN ROW's org at owner, 400 on a missing note,
// 409 on a plan that is not pending, and nothing decided unless every gate passed.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));

const gates = { selfHosted: true, sameOrigin: true, roleOrgs: [] as string[], deny: null as string | null };
vi.mock("@/lib/api/self-host", () => ({
  selfHostGuard: () => (gates.selfHosted ? null : new Response(JSON.stringify({ error: "Not found." }), { status: 404 })),
}));
vi.mock("@/lib/api/orgPlan", () => ({ dbGuard: () => null }));
vi.mock("@/lib/auth", () => ({
  PUBLIC_ORG: "public",
  requireSameOrigin: () => (gates.sameOrigin ? null : new Response(JSON.stringify({ error: "Cross-origin." }), { status: 403 })),
}));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: vi.fn(async () => "kaz") }));
vi.mock("@/lib/authz", () => ({
  requireOrgRole: vi.fn(async (org: string, role: string) => {
    gates.roleOrgs.push(`${org}:${role}`);
    return gates.deny === org ? new Response(JSON.stringify({ error: "Forbidden." }), { status: 403 }) : null;
  }),
}));

const plans = new Map<string, { id: string; org: string; status: string }>();
vi.mock("@/lib/db/loop-plans", () => ({
  getLoopPlanOrgSlug: vi.fn(async (id: string) => plans.get(id)?.org ?? null),
  getLoopPlan: vi.fn(async (id: string) => plans.get(id) ?? null),
}));
const decided: unknown[] = [];
vi.mock("@/lib/db/loop-plan-decide", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/loop-plan-decide")>("@/lib/db/loop-plan-decide");
  return {
    parseDecisionBody: actual.parseDecisionBody,
    decideLoopPlan: vi.fn(async (input: { plan: { id: string }; orgSlug: string; body: { decision: string }; decidedBy: string | null }) => {
      decided.push(input);
      return { ok: true, plan: { ...input.plan, status: input.body.decision === "approve" ? "approved" : "rejected" }, direction: null };
    }),
  };
});

import { POST } from "./route";

const post = (id: string, body: unknown) =>
  POST(new Request(`http://localhost/api/org/loop/plans/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  Object.assign(gates, { selfHosted: true, sameOrigin: true, roleOrgs: [], deny: null });
  decided.length = 0;
  plans.clear();
  plans.set("p-acme", { id: "p-acme", org: "acme", status: "pending" });
  plans.set("p-other", { id: "p-other", org: "other", status: "pending" });
  plans.set("p-done", { id: "p-done", org: "acme", status: "approved" });
});

describe("POST /api/org/loop/plans/[id]", () => {
  it("gates the ROW's org at owner, then decides as the signed-in viewer", async () => {
    const res = await post("p-acme", { decision: "approve", note: "" });
    expect(res.status).toBe(200);
    expect(gates.roleOrgs).toEqual(["acme:owner"]);
    expect(decided).toEqual([expect.objectContaining({ orgSlug: "acme", decidedBy: "kaz", body: { decision: "approve", note: "" } })]);
  });

  it("authorizes against the plan's own org, whatever the caller claims", async () => {
    gates.deny = "other";
    const res = await post("p-other", { decision: "approve", note: "", org: "acme" });
    expect(res.status).toBe(403);
    expect(gates.roleOrgs).toEqual(["other:owner"]);
    expect(decided).toEqual([]);
  });

  it("404s an unknown plan before any gate or body is read", async () => {
    expect((await post("nope", { decision: "approve" })).status).toBe(404);
    expect(gates.roleOrgs).toEqual([]);
  });

  it("400s a reject or revise without a note", async () => {
    expect((await post("p-acme", { decision: "reject" })).status).toBe(400);
    expect((await post("p-acme", { decision: "revise", note: " " })).status).toBe(400);
    expect(decided).toEqual([]);
  });

  it("409s a plan that is no longer pending", async () => {
    expect((await post("p-done", { decision: "reject", note: "no" })).status).toBe(409);
    expect(decided).toEqual([]);
  });

  it("refuses cross-origin writes and 404s off a self-hosted deployment", async () => {
    gates.sameOrigin = false;
    expect((await post("p-acme", { decision: "approve" })).status).toBe(403);
    gates.sameOrigin = true;
    gates.selfHosted = false;
    expect((await post("p-acme", { decision: "approve" })).status).toBe(404);
    expect(decided).toEqual([]);
  });
});
