// Pins source-scoped tier revocation through the real webhook handlers: a revoke or full refund for a
// subscription that is NOT the one granting the org's current tier must not downgrade the org, while
// the granting subscription's cancel / refund still does (declared guards). The db/polar boundaries
// are mocked with the same pattern as route.test.ts; the Subscription row is what grantingSubId reads.

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const cap = vi.hoisted(() => ({
  config: null as null | {
    onOrderRefunded: (p: unknown) => Promise<void>;
    onSubscriptionRevoked: (p: unknown) => Promise<void>;
    onSubscriptionCanceled: (p: unknown) => Promise<void>;
  },
  upsert: vi.fn(async () => ({ id: "subrow" })),
  row: null as null | { stripeId: string | null; status: string },
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
  getCreditState: vi.fn(async () => ({ balance: 0, plan: "pro", unlimited: false, orgExists: true })),
  grantCredits: vi.fn(async () => 10),
  setOrgPlan: vi.fn(async () => true),
  isDbConfigured: vi.fn(() => true),
  getOrgId: vi.fn(async (): Promise<string | null> => "org_acme"),
  getPrisma: vi.fn(() => ({
    subscription: { upsert: cap.upsert, findUnique: vi.fn(async () => cap.row) },
  })),
}));
vi.mock("@/lib/polar", () => ({
  creditsForProduct: vi.fn(() => 0),
  planForProduct: vi.fn(() => null),
  getPolar: vi.fn(() => null),
}));

import { clawbackOrderRefund, getCreditState, setOrgPlan } from "@/lib/db";
import { creditsForProduct, planForProduct } from "@/lib/polar";

const mockClawback = vi.mocked(clawbackOrderRefund);
const mockCreditState = vi.mocked(getCreditState);
const mockSetPlan = vi.mocked(setOrgPlan);
const mockCredits = vi.mocked(creditsForProduct);
const mockPlan = vi.mocked(planForProduct);

let onOrderRefunded: (p: unknown) => Promise<void>;
let onSubscriptionRevoked: (p: unknown) => Promise<void>;
let onSubscriptionCanceled: (p: unknown) => Promise<void>;
let info: ReturnType<typeof vi.spyOn>;

const acme = { customer: { externalId: "acme" }, metadata: null };
const sub = (id: string, productId = "prod_pro") => ({ id, productId, ...acme, cancelAtPeriodEnd: false, currentPeriodEnd: new Date("2026-11-01T00:00:00Z") });
const fullRefund = (subscriptionId: string | null, productId = "prod_pro") => ({
  data: { id: "ord_renew", productId, ...acme, netAmount: 1000, totalAmount: 1000, refundedAmount: 1000, subscriptionId, subscription: null },
});
const plan = (p: string) => ({ balance: 0, plan: p, unlimited: false, orgExists: true });

beforeAll(async () => {
  process.env.POLAR_WEBHOOK_SECRET = "whsec_test";
  await import("./route");
  onOrderRefunded = cap.config!.onOrderRefunded;
  onSubscriptionRevoked = cap.config!.onSubscriptionRevoked;
  onSubscriptionCanceled = cap.config!.onSubscriptionCanceled;
  info = vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

beforeEach(() => {
  vi.clearAllMocks();
  mockSetPlan.mockResolvedValue(true);
  mockClawback.mockResolvedValue(0);
  mockCredits.mockReturnValue(0);
  mockPlan.mockImplementation((id) => (id === "prod_pro" ? "pro" : id === "prod_team" ? "team" : null));
  mockCreditState.mockResolvedValue(plan("pro"));
  cap.row = { stripeId: "sub_B", status: "active" };
});

const logged = () => info.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");

describe("revocation scoped to the granting subscription", () => {
  it("same-tier replacement: revoke of the old sub_A leaves pro granted by sub_B untouched", async () => {
    await onSubscriptionRevoked({ data: sub("sub_A") });
    expect(mockSetPlan).not.toHaveBeenCalled();
    expect(cap.upsert).not.toHaveBeenCalled();
    expect(logged()).toContain("granting subscription sub_B");
  });

  it("lower-tier replacement: Team -> Starter via new sub_B; the old Team revoke does not floor to free", async () => {
    await onSubscriptionRevoked({ data: sub("sub_A", "prod_team") });
    expect(mockSetPlan).not.toHaveBeenCalled();
  });

  it("immediate cancel of a replaced subscription does not downgrade either", async () => {
    await onSubscriptionCanceled({ data: sub("sub_A") });
    expect(mockSetPlan).not.toHaveBeenCalled();
  });

  it("full refund of a renewal order of replaced sub_A: no downgrade, pack clawback still runs", async () => {
    mockCredits.mockReturnValue(100);
    await onOrderRefunded(fullRefund("sub_A"));
    expect(mockSetPlan).not.toHaveBeenCalled();
    expect(mockClawback).toHaveBeenCalledWith("acme", "ord_renew", 100, expect.objectContaining({ actor: "polar" }));
  });

  it("full refund of the GRANTING subscription's order downgrades AND marks the Subscription row inactive", async () => {
    await onOrderRefunded(fullRefund("sub_B"));
    expect(mockSetPlan).toHaveBeenCalledWith("acme", "free");
    expect(cap.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { status: "inactive", stripeId: "sub_B" } }),
    );
  });
});

describe("guards: unchanged paths", () => {
  it("revoke of the granting subscription still downgrades and writes the row inactive", async () => {
    await onSubscriptionRevoked({ data: sub("sub_B") });
    expect(mockSetPlan).toHaveBeenCalledWith("acme", "free");
    expect(cap.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { status: "inactive", stripeId: "sub_B" } }));
  });

  it("immediate cancel of the granting subscription still downgrades", async () => {
    await onSubscriptionCanceled({ data: sub("sub_B") });
    expect(mockSetPlan).toHaveBeenCalledWith("acme", "free");
  });

  it("full refund of the granting subscription's order still downgrades", async () => {
    await onOrderRefunded(fullRefund("sub_B"));
    expect(mockSetPlan).toHaveBeenCalledWith("acme", "free");
  });

  it("no Subscription row: rank fallback still downgrades a same-tier revoke", async () => {
    cap.row = null;
    await onSubscriptionRevoked({ data: sub("sub_A") });
    expect(mockSetPlan).toHaveBeenCalledWith("acme", "free");
  });

  it("manual enterprise override with no Subscription row is retained", async () => {
    cap.row = null;
    mockCreditState.mockResolvedValue(plan("enterprise"));
    await onSubscriptionRevoked({ data: sub("sub_A") });
    expect(mockSetPlan).not.toHaveBeenCalled();
  });

  it("an inactive row naming another subscription is not a grantor: rank fallback downgrades", async () => {
    cap.row = { stripeId: "sub_B", status: "inactive" };
    await onSubscriptionRevoked({ data: sub("sub_A") });
    expect(mockSetPlan).toHaveBeenCalledWith("acme", "free");
  });

  it("partial refund of the granting order never downgrades", async () => {
    const p = fullRefund("sub_B");
    p.data.refundedAmount = 500;
    await onOrderRefunded(p);
    expect(mockSetPlan).not.toHaveBeenCalled();
  });
});
