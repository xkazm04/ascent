// THE PROPOSALS LEDGER READ — gated on the caller's org, filters parsed strictly.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
const gates = { selfHosted: true, denied: false, accessed: [] as string[] };
vi.mock("@/lib/api/self-host", () => ({
  selfHostGuard: () => (gates.selfHosted ? null : new Response(JSON.stringify({ error: "Not found." }), { status: 404 })),
}));
vi.mock("@/lib/auth", () => ({ PUBLIC_ORG: "public" }));
vi.mock("@/lib/authz", () => ({
  requireOrgAccess: vi.fn(async (org: string) => {
    gates.accessed.push(org);
    return gates.denied ? new Response(JSON.stringify({ error: "Forbidden." }), { status: 403 }) : null;
  }),
}));
const { listLoopPlans } = vi.hoisted(() => ({ listLoopPlans: vi.fn<(org: string, opts: unknown) => Promise<{ id: string }[]>>(async () => [{ id: "p1" }]) }));
vi.mock("@/lib/db/loop-plans", () => ({
  listLoopPlans,
  isPlanStatus: (v: unknown) => v === "pending" || v === "approved",
}));

import { GET } from "./route";

const get = (qs: string) => GET(new Request(`http://localhost/api/org/loop/plans?${qs}`));

beforeEach(() => {
  Object.assign(gates, { selfHosted: true, denied: false, accessed: [] });
  listLoopPlans.mockClear();
});

describe("GET /api/org/loop/plans", () => {
  it("lists the caller's org's plans with parsed filters, dropping unknown statuses", async () => {
    const res = await get("org=Acme&status=pending,bogus,approved&repo=acme/web&limit=20");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ plans: [{ id: "p1" }] });
    expect(gates.accessed).toEqual(["acme"]);
    expect(listLoopPlans).toHaveBeenCalledWith("acme", { status: ["pending", "approved"], repo: "acme/web", limit: 20 });
  });

  it("refuses a missing or public org, a denied caller, and a managed-cloud deployment", async () => {
    expect((await get("")).status).toBe(400);
    expect((await get("org=public")).status).toBe(400);
    gates.denied = true;
    expect((await get("org=acme")).status).toBe(403);
    gates.selfHosted = false;
    expect((await get("org=acme")).status).toBe(404);
    expect(listLoopPlans).not.toHaveBeenCalled();
  });
});
