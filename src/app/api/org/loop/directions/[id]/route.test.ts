// ENDING A DIRECTION — resolve-then-gate against the DIRECTION ROW's org at owner; the list read is
// gated on the caller's org. (The lifecycle each action applies is loop-plans.test.ts's.)

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
const gates = { roleOrgs: [] as string[], deny: null as string | null, audits: [] as string[] };
vi.mock("@/lib/api/self-host", () => ({ selfHostGuard: () => null }));
vi.mock("@/lib/api/orgPlan", () => ({ dbGuard: () => null }));
vi.mock("@/lib/auth", () => ({ PUBLIC_ORG: "public", requireSameOrigin: () => null }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: vi.fn(async () => "kaz") }));
vi.mock("@/lib/authz", () => ({
  requireOrgAccess: vi.fn(async () => null),
  requireOrgRole: vi.fn(async (org: string, role: string) => {
    gates.roleOrgs.push(`${org}:${role}`);
    return gates.deny === org ? new Response(JSON.stringify({ error: "Forbidden." }), { status: 403 }) : null;
  }),
}));
vi.mock("@/lib/db/scans-audit", () => ({ recordAudit: vi.fn(async (a: string) => (gates.audits.push(a), true)) }));
const { dirs, settleDirection } = vi.hoisted(() => {
  const dirs = new Map<string, { id: string; org: string; status: string }>();
  const settleDirection = vi.fn(async (id: string, action: string) => {
    const d = dirs.get(id);
    if (!d || (d.status !== "active" && d.status !== "exhausted")) return null;
    d.status = action === "revoke" ? "revoked" : "done";
    return { id, orgId: `org-${d.org}`, repo: "acme/web", status: d.status, usedCycles: 1, budgetCycles: 3 };
  });
  return { dirs, settleDirection };
});
vi.mock("@/lib/db/loop-directions", () => ({
  getLoopDirectionOrgSlug: vi.fn(async (id: string) => dirs.get(id)?.org ?? null),
  settleDirection,
  listLoopDirections: vi.fn(async () => [{ id: "d1" }]),
  isDirectionStatus: (v: unknown) => v === "active",
}));

import { POST } from "./route";
import { GET } from "../route";

const post = (id: string, body: unknown) =>
  POST(new Request(`http://localhost/api/org/loop/directions/${id}`, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  Object.assign(gates, { roleOrgs: [], deny: null, audits: [] });
  settleDirection.mockClear();
  dirs.clear();
  dirs.set("d-acme", { id: "d-acme", org: "acme", status: "active" });
  dirs.set("d-other", { id: "d-other", org: "other", status: "active" });
});

describe("POST /api/org/loop/directions/[id]", () => {
  it("revokes under the ROW's org at owner and audits it", async () => {
    const res = await post("d-acme", { action: "revoke" });
    expect(res.status).toBe(200);
    expect(gates.roleOrgs).toEqual(["acme:owner"]);
    expect(gates.audits).toEqual(["loop.direction_revoked"]);
  });

  it("never touches another tenant's direction", async () => {
    gates.deny = "other";
    expect((await post("d-other", { action: "done" })).status).toBe(403);
    expect(settleDirection).not.toHaveBeenCalled();
  });

  it("404s an unknown id, 400s an unknown action, 409s an ended direction", async () => {
    expect((await post("nope", { action: "done" })).status).toBe(404);
    expect((await post("d-acme", { action: "pause" })).status).toBe(400);
    expect((await post("d-acme", { action: "done" })).status).toBe(200);
    expect((await post("d-acme", { action: "revoke" })).status).toBe(409);
    expect(gates.audits).toEqual(["loop.direction_done"]);
  });
});

describe("GET /api/org/loop/directions", () => {
  it("lists the caller's org's directions", async () => {
    const res = await GET(new Request("http://localhost/api/org/loop/directions?org=acme&status=active"));
    expect(await res.json()).toEqual({ directions: [{ id: "d1" }] });
  });
});
