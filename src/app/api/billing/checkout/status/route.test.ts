// Pins the read-only checkout status route the return banner polls. It mirrors the checkout / portal
// guards (Polar off 503, prefetch 204, same-origin, owner gate), constrains the Polar checkout to the
// org it was minted for (a foreign or unknown checkout is the SAME uniform 404, so it is not an
// existence oracle for another org's purchases), and only claims "landed" from a grant record that
// exists: the CreditLedger row `polar:<orderId>` for a pack, the org plan + live Subscription for a tier.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => {
  const NextResponse: unknown = function (body: unknown, init?: { status?: number }) {
    return new Response(body as BodyInit | null, init);
  };
  (NextResponse as { json: unknown }).json = (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), init);
  return { NextResponse };
});
vi.mock("@/lib/polar", () => ({
  polarEnabled: vi.fn(() => true),
  getPolar: vi.fn(),
  creditsForProduct: vi.fn((id: string) => (id === "pack_500" ? 500 : 0)),
  planForProduct: vi.fn((id: string) => (id === "plan_team" ? "team" : null)),
}));
const findFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  isDbConfigured: vi.fn(() => true),
  getPrisma: () => ({ creditLedger: { findFirst } }),
  getCreditState: vi.fn(async () => ({ balance: 620, plan: "free", unlimited: false, orgExists: true })),
}));
vi.mock("@/lib/billing/subscriptionRecord", () => ({ getOrgSubscription: vi.fn(async () => null) }));
vi.mock("@/lib/auth", () => {
  const isSameOrigin = vi.fn(() => true);
  return {
    isSameOrigin,
    requireSameOrigin: vi.fn((req: Request) =>
      isSameOrigin(req) ? null : Response.json({ error: "Cross-origin request rejected." }, { status: 403 }),
    ),
  };
});
vi.mock("@/lib/authz", () => ({ refusePublicOrgAdmin: vi.fn(() => null), requireOrgRole: vi.fn(async () => null) }));

import { GET } from "./route";
import { getPolar, polarEnabled } from "@/lib/polar";
import { getCreditState } from "@/lib/db";
import { getOrgSubscription } from "@/lib/billing/subscriptionRecord";
import { isSameOrigin } from "@/lib/auth";
import { requireOrgRole } from "@/lib/authz";

const getCheckout = vi.fn();
const listOrders = vi.fn();
const ago = (ms: number) => new Date(Date.now() - ms);

function checkout(over: Record<string, unknown> = {}) {
  return { id: "co_1", status: "succeeded", externalCustomerId: "acme", metadata: { org: "acme" }, productId: "pack_500", createdAt: ago(60_000), modifiedAt: null, ...over };
}
function orders(items: Array<Record<string, unknown>>) {
  return { result: { items } };
}
const order = (over: Record<string, unknown> = {}) => ({ id: "ord_9", productId: "pack_500", subscriptionId: null, createdAt: ago(60_000), ...over });

function req(query = "org=acme&checkout_id=co_1", headers: Record<string, string> = {}) {
  return new Request(`https://ascent.test/api/billing/checkout/status?${query}`, { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(polarEnabled).mockReturnValue(true);
  vi.mocked(isSameOrigin).mockReturnValue(true);
  vi.mocked(requireOrgRole).mockResolvedValue(null);
  getCheckout.mockResolvedValue(checkout());
  listOrders.mockResolvedValue(orders([order()]));
  findFirst.mockResolvedValue(null);
  vi.mocked(getPolar).mockReturnValue({ checkouts: { get: getCheckout }, orders: { list: listOrders } } as unknown as ReturnType<typeof getPolar>);
});

describe("GET /api/billing/checkout/status - guards", () => {
  it("503 when Polar is off, 204 on a prefetch, 403 cross-origin; none reach Polar", async () => {
    vi.mocked(polarEnabled).mockReturnValueOnce(false);
    expect((await GET(req())).status).toBe(503);
    expect((await GET(req(undefined, { "sec-purpose": "prefetch" }))).status).toBe(204);
    vi.mocked(isSameOrigin).mockReturnValueOnce(false);
    expect((await GET(req())).status).toBe(403);
    expect(getCheckout).not.toHaveBeenCalled();
  });

  it("400 on a missing org, a missing checkout id, or an unsubstituted placeholder", async () => {
    expect((await GET(req("checkout_id=co_1"))).status).toBe(400);
    expect((await GET(req("org=acme"))).status).toBe(400);
    expect((await GET(req("org=acme&checkout_id={CHECKOUT_ID}"))).status).toBe(400);
    expect(getCheckout).not.toHaveBeenCalled();
  });

  it("is owner-gated before any Polar read", async () => {
    const denial = new Response(null, { status: 403 });
    vi.mocked(requireOrgRole).mockResolvedValueOnce(denial as never);
    expect(await GET(req("org=Acme&checkout_id=co_1"))).toBe(denial);
    expect(requireOrgRole).toHaveBeenCalledWith("acme", "owner");
    expect(getCheckout).not.toHaveBeenCalled();
  });

  it("another org's checkout is a uniform 404 'Unknown checkout.' and reads nothing further", async () => {
    getCheckout.mockResolvedValue(checkout({ externalCustomerId: "other", metadata: { org: "other" } }));
    const res = await GET(req());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Unknown checkout." });
    expect(listOrders).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("binds via metadata.org when no external customer id is set; a Polar 404 is the same uniform 404", async () => {
    getCheckout.mockResolvedValueOnce(checkout({ externalCustomerId: null, metadata: { org: "other" } }));
    expect((await GET(req())).status).toBe(404);
    getCheckout.mockRejectedValueOnce(Object.assign(new Error("not found"), { statusCode: 404 }));
    const res = await GET(req());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Unknown checkout." });
  });

  it("a Polar outage is a retryable 503, not a 404", async () => {
    getCheckout.mockRejectedValueOnce(Object.assign(new Error("upstream"), { statusCode: 502 }));
    expect((await GET(req())).status).toBe(503);
  });
});

describe("GET /api/billing/checkout/status - states", () => {
  it("a confirmed checkout is confirming and never looks up an order", async () => {
    getCheckout.mockResolvedValue(checkout({ status: "confirmed" }));
    const res = await GET(req());
    expect(await res.json()).toEqual({ state: "confirming" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(listOrders).not.toHaveBeenCalled();
  });

  it("succeeded + order ord_9 + ledger row polar:ord_9 -> landed with the credits and balance", async () => {
    findFirst.mockResolvedValue({ delta: 500 });
    const res = await GET(req());
    expect(await res.json()).toEqual({ state: "landed", orderId: "ord_9", credits: 500, balance: 620 });
    expect(listOrders).toHaveBeenCalledWith(expect.objectContaining({ checkoutId: "co_1" }));
    // The ledger lookup is constrained to THIS org, not just the order id.
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { externalId: "polar:ord_9", org: { slug: "acme" } } }));
  });

  it("ledger row absent -> paid carrying the order id; after 11 minutes -> stalled", async () => {
    expect(await (await GET(req())).json()).toEqual({ state: "paid", orderId: "ord_9" });
    listOrders.mockResolvedValue(orders([order({ createdAt: ago(11 * 60_000) })]));
    expect(await (await GET(req())).json()).toEqual({ state: "stalled", orderId: "ord_9" });
  });

  it("succeeded but Polar has not created the order yet -> paid without an id", async () => {
    listOrders.mockResolvedValue(orders([]));
    expect(await (await GET(req())).json()).toEqual({ state: "paid" });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("a plan order lands only when the org holds the tier AND its Subscription row is live", async () => {
    getCheckout.mockResolvedValue(checkout({ productId: "plan_team" }));
    listOrders.mockResolvedValue(orders([order({ productId: "plan_team", subscriptionId: "sub_1" })]));
    expect((await (await GET(req())).json()).state).toBe("paid");
    const team = { balance: 620, plan: "team", unlimited: false, orgExists: true };
    vi.mocked(getCreditState).mockResolvedValueOnce(team).mockResolvedValueOnce(team);
    vi.mocked(getOrgSubscription).mockResolvedValueOnce({ stripeId: "sub_other", status: "active" });
    expect((await (await GET(req())).json()).state).toBe("paid");
    vi.mocked(getOrgSubscription).mockResolvedValueOnce({ stripeId: "sub_1", status: "active" });
    expect(await (await GET(req())).json()).toEqual({ state: "landed", orderId: "ord_9", plan: "team" });
  });
});
