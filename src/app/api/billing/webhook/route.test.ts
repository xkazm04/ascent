// Pins Polar fulfilment — the money-IN trust boundary. The @polar-sh/nextjs Webhooks() adapter verifies
// the signature (mocked here to CAPTURE the handlers), then onOrderPaid grants credits / upgrades the plan
// server-authoritatively from the PRODUCT, and onOrderRefunded claws credits back proportionally. Two
// invariants matter and are asserted: (1) a paid order that can't be fulfilled yet must THROW (so Polar
// redelivers under at-least-once) rather than silently drop a real purchase; (2) the route FAILS CLOSED
// (503) when POLAR_WEBHOOK_SECRET is unset. The db/polar boundaries are mocked; the handlers run for real.

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// Capture the config object handed to Webhooks() at module load so the tests can invoke the handlers.
const cap = vi.hoisted(() => ({
  config: null as null | {
    onOrderPaid: (p: unknown) => Promise<void>;
    onOrderRefunded: (p: unknown) => Promise<void>;
    onSubscriptionRevoked: (p: unknown) => Promise<void>;
    onSubscriptionCanceled: (p: unknown) => Promise<void>;
  },
}));

vi.mock("@polar-sh/nextjs", () => ({
  Webhooks: (config: typeof cap.config) => {
    cap.config = config;
    return async () => new Response(null, { status: 200 });
  },
}));
vi.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => new Response(JSON.stringify(body), init) },
}));
vi.mock("@/lib/db", () => ({
  clawbackOrderRefund: vi.fn(async () => 0),
  grantCredits: vi.fn(async () => 10),
  setOrgPlan: vi.fn(async () => true),
}));
vi.mock("@/lib/polar", () => ({
  creditsForProduct: vi.fn(() => 0),
  planForProduct: vi.fn(() => null),
}));

import { clawbackOrderRefund, grantCredits, setOrgPlan } from "@/lib/db";
import { creditsForProduct, planForProduct } from "@/lib/polar";

const mockClawback = vi.mocked(clawbackOrderRefund);
const mockGrant = vi.mocked(grantCredits);
const mockSetPlan = vi.mocked(setOrgPlan);
const mockCredits = vi.mocked(creditsForProduct);
const mockPlan = vi.mocked(planForProduct);

let onOrderPaid: (p: unknown) => Promise<void>;
let onOrderRefunded: (p: unknown) => Promise<void>;
let onSubscriptionRevoked: (p: unknown) => Promise<void>;
let onSubscriptionCanceled: (p: unknown) => Promise<void>;

// The order's embedded subscription (present for subscription/renewal orders; null for one-time packs).
type OrderSub = { status: string; endedAt: Date | null };
type Order = {
  id: string;
  productId: string;
  customer: { externalId: string | null } | null;
  metadata: Record<string, unknown> | null;
  netAmount: number;
  totalAmount: number;
  refundedAmount: number;
  subscription: OrderSub | null;
};
function order(over: Partial<Order> = {}): Order {
  return { id: "ord1", productId: "prod_1", customer: { externalId: "acme" }, metadata: null, netAmount: 1000, totalAmount: 1000, refundedAmount: 0, subscription: null, ...over };
}

// A Subscription webhook payload's `data` (only the fields the downgrade handlers read).
type Sub = {
  id: string;
  productId: string;
  customer: { externalId: string | null } | null;
  metadata: Record<string, unknown> | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date;
};
function sub(over: Partial<Sub> = {}): Sub {
  return { id: "sub1", productId: "prod_pro", customer: { externalId: "acme" }, metadata: null, cancelAtPeriodEnd: false, currentPeriodEnd: new Date("2026-08-01T00:00:00Z"), ...over };
}

beforeAll(async () => {
  // The secret must be present at import so the Webhooks() branch runs and captures the handlers.
  process.env.POLAR_WEBHOOK_SECRET = "whsec_test";
  await import("./route");
  onOrderPaid = cap.config!.onOrderPaid;
  onOrderRefunded = cap.config!.onOrderRefunded;
  onSubscriptionRevoked = cap.config!.onSubscriptionRevoked;
  onSubscriptionCanceled = cap.config!.onSubscriptionCanceled;
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGrant.mockResolvedValue(10);
  mockSetPlan.mockResolvedValue(true);
  mockClawback.mockResolvedValue(0);
  mockCredits.mockReturnValue(0);
  mockPlan.mockReturnValue(null);
});

describe("onOrderPaid — fulfil from the product", () => {
  it("grants credits for a credit-pack product, idempotent on the Polar order id", async () => {
    mockCredits.mockReturnValue(100);
    await onOrderPaid({ data: order() });
    expect(mockGrant).toHaveBeenCalledWith("acme", 100, { reason: "polar", actor: "polar", externalId: "polar:ord1" });
    expect(mockSetPlan).not.toHaveBeenCalled();
  });

  it("upgrades the plan for a plan-tier product (no credits)", async () => {
    mockPlan.mockReturnValue("pro");
    await onOrderPaid({ data: order() });
    expect(mockSetPlan).toHaveBeenCalledWith("acme", "pro");
    expect(mockGrant).not.toHaveBeenCalled();
  });

  it("does BOTH for a product mapped to credits + a tier (plan applied before the grant)", async () => {
    mockCredits.mockReturnValue(100);
    mockPlan.mockReturnValue("team");
    await onOrderPaid({ data: order() });
    expect(mockSetPlan).toHaveBeenCalledWith("acme", "team");
    expect(mockGrant).toHaveBeenCalledWith("acme", 100, expect.objectContaining({ externalId: "polar:ord1" }));
    expect(mockSetPlan.mock.invocationCallOrder[0]).toBeLessThan(mockGrant.mock.invocationCallOrder[0]);
  });

  it("does nothing (no throw) for a product that is neither a pack nor a tier", async () => {
    await onOrderPaid({ data: order() }); // credits 0, plan null
    expect(mockGrant).not.toHaveBeenCalled();
    expect(mockSetPlan).not.toHaveBeenCalled();
  });

  it("binds the org from checkout metadata when the customer externalId is absent", async () => {
    mockCredits.mockReturnValue(50);
    await onOrderPaid({ data: order({ customer: null, metadata: { org: "acme" } }) });
    expect(mockGrant).toHaveBeenCalledWith("acme", 50, expect.objectContaining({ externalId: "polar:ord1" }));
  });

  it("THROWS (so Polar retries) when a paid order has no org bound — never silently drops the purchase", async () => {
    mockCredits.mockReturnValue(100);
    await expect(onOrderPaid({ data: order({ customer: null, metadata: null }) })).rejects.toThrow();
    expect(mockGrant).not.toHaveBeenCalled();
  });

  it("THROWS when setOrgPlan can't find the org (plan not applied → retry)", async () => {
    mockPlan.mockReturnValue("pro");
    mockSetPlan.mockResolvedValue(false);
    await expect(onOrderPaid({ data: order() })).rejects.toThrow();
  });

  it("THROWS when the credit grant returns null (org not found → retry)", async () => {
    mockCredits.mockReturnValue(100);
    mockGrant.mockResolvedValue(null);
    await expect(onOrderPaid({ data: order() })).rejects.toThrow();
  });
});

describe("onOrderRefunded — proportional clawback", () => {
  it("ignores a refund on a non-credit-pack order (nothing was ever granted)", async () => {
    await onOrderRefunded({ data: order({ refundedAmount: 1000 }) }); // credits 0
    expect(mockClawback).not.toHaveBeenCalled();
  });

  it("claws back the WHOLE pack on a full refund", async () => {
    mockCredits.mockReturnValue(100);
    await onOrderRefunded({ data: order({ netAmount: 1000, refundedAmount: 1000 }) });
    expect(mockClawback).toHaveBeenCalledWith("acme", "ord1", 100, { eventKey: "1000", actor: "polar" });
  });

  it("claws back the proportional share on a partial refund (40% → 40 of 100)", async () => {
    mockCredits.mockReturnValue(100);
    await onOrderRefunded({ data: order({ netAmount: 1000, refundedAmount: 400 }) });
    expect(mockClawback).toHaveBeenCalledWith("acme", "ord1", 40, { eventKey: "400", actor: "polar" });
  });

  it("falls back to totalAmount for the gross when netAmount is unavailable", async () => {
    mockCredits.mockReturnValue(100);
    await onOrderRefunded({ data: order({ netAmount: 0, totalAmount: 1000, refundedAmount: 500 }) });
    expect(mockClawback).toHaveBeenCalledWith("acme", "ord1", 50, { eventKey: "500", actor: "polar" });
  });

  it("does not throw (and skips the clawback) when the refunded order has no org bound", async () => {
    mockCredits.mockReturnValue(100);
    await expect(onOrderRefunded({ data: order({ customer: null, metadata: null, refundedAmount: 1000 }) })).resolves.toBeUndefined();
    expect(mockClawback).not.toHaveBeenCalled();
  });
});

describe("stale / out-of-order paid must not resurrect a cancelled tier", () => {
  it("applies the tier when the paid order's subscription is still active", async () => {
    mockPlan.mockReturnValue("pro");
    await onOrderPaid({ data: order({ subscription: { status: "active", endedAt: null } }) });
    expect(mockSetPlan).toHaveBeenCalledWith("acme", "pro");
  });

  it("does NOT re-grant the tier when a late paid event's subscription is already canceled", async () => {
    mockPlan.mockReturnValue("pro");
    await onOrderPaid({ data: order({ subscription: { status: "canceled", endedAt: null } }) });
    expect(mockSetPlan).not.toHaveBeenCalled();
  });

  it("does NOT re-grant the tier when the subscription has already ended", async () => {
    mockPlan.mockReturnValue("team");
    await onOrderPaid({ data: order({ subscription: { status: "active", endedAt: new Date("2026-07-01T00:00:00Z") } }) });
    expect(mockSetPlan).not.toHaveBeenCalled();
  });

  it("still applies the tier for a one-time order with no subscription (nothing to reconcile)", async () => {
    mockPlan.mockReturnValue("pro");
    await onOrderPaid({ data: order({ subscription: null }) });
    expect(mockSetPlan).toHaveBeenCalledWith("acme", "pro");
  });
});

describe("onSubscriptionRevoked — downgrade to free", () => {
  it("downgrades a plan subscription's org to free on revoke", async () => {
    mockPlan.mockReturnValue("pro");
    await onSubscriptionRevoked({ data: sub() });
    expect(mockSetPlan).toHaveBeenCalledWith("acme", "free");
  });

  it("binds the org from subscription metadata when the customer externalId is absent", async () => {
    mockPlan.mockReturnValue("team");
    await onSubscriptionRevoked({ data: sub({ customer: null, metadata: { org: "acme" } }) });
    expect(mockSetPlan).toHaveBeenCalledWith("acme", "free");
  });

  it("is a safe no-op on replay — idempotent setOrgPlan(free) both times, no throw", async () => {
    mockPlan.mockReturnValue("pro");
    await onSubscriptionRevoked({ data: sub() });
    await expect(onSubscriptionRevoked({ data: sub() })).resolves.toBeUndefined();
    expect(mockSetPlan).toHaveBeenNthCalledWith(1, "acme", "free");
    expect(mockSetPlan).toHaveBeenNthCalledWith(2, "acme", "free");
  });

  it("does nothing for a revoke on a non-plan subscription", async () => {
    mockPlan.mockReturnValue(null);
    await onSubscriptionRevoked({ data: sub() });
    expect(mockSetPlan).not.toHaveBeenCalled();
  });

  it("does not throw (and skips) when the subscription has no org bound", async () => {
    mockPlan.mockReturnValue("pro");
    await expect(onSubscriptionRevoked({ data: sub({ customer: null, metadata: null }) })).resolves.toBeUndefined();
    expect(mockSetPlan).not.toHaveBeenCalled();
  });
});

describe("onSubscriptionCanceled — respect cancel-at-period-end", () => {
  it("does NOT downgrade a cancel-at-period-end subscription (still entitled until period end)", async () => {
    mockPlan.mockReturnValue("pro");
    await onSubscriptionCanceled({ data: sub({ cancelAtPeriodEnd: true }) });
    expect(mockSetPlan).not.toHaveBeenCalled();
  });

  it("DOES downgrade an immediate cancellation (cancelAtPeriodEnd false)", async () => {
    mockPlan.mockReturnValue("pro");
    await onSubscriptionCanceled({ data: sub({ cancelAtPeriodEnd: false }) });
    expect(mockSetPlan).toHaveBeenCalledWith("acme", "free");
  });
});

describe("onOrderRefunded — full refund of a plan order revokes the tier", () => {
  it("downgrades to free on a FULL refund of a plan product", async () => {
    mockPlan.mockReturnValue("team");
    await onOrderRefunded({ data: order({ netAmount: 2000, refundedAmount: 2000 }) });
    expect(mockSetPlan).toHaveBeenCalledWith("acme", "free");
  });

  it("does NOT downgrade on a PARTIAL refund of a plan product", async () => {
    mockPlan.mockReturnValue("team");
    await onOrderRefunded({ data: order({ netAmount: 2000, refundedAmount: 500 }) });
    expect(mockSetPlan).not.toHaveBeenCalled();
  });

  it("claws back credits AND downgrades on a full refund of a combined pack+tier product", async () => {
    mockCredits.mockReturnValue(100);
    mockPlan.mockReturnValue("pro");
    await onOrderRefunded({ data: order({ netAmount: 1000, refundedAmount: 1000 }) });
    expect(mockClawback).toHaveBeenCalledWith("acme", "ord1", 100, { eventKey: "1000", actor: "polar" });
    expect(mockSetPlan).toHaveBeenCalledWith("acme", "free");
  });
});

describe("fail-closed when unconfigured", () => {
  it("returns 503 (does not trust an unverified body) when POLAR_WEBHOOK_SECRET is unset", async () => {
    vi.resetModules();
    delete process.env.POLAR_WEBHOOK_SECRET;
    const mod = await import("./route");
    const res = await mod.POST(new Request("http://localhost/api/billing/webhook", { method: "POST" }));
    expect(res.status).toBe(503);
  });
});
