// Replays Polar lifecycle SEQUENCES through the webhook handlers against an in-memory org-plan store and
// a mutable "provider truth", and counts which sequences leave a non-paying org on a paid tier. The
// handlers run for real; only the db and the Polar client are replaced. Each sequence is a delivery
// pattern Polar's at-least-once, unordered webhooks can produce — a renewal `order.paid` redelivered
// after `subscription.revoked`, a revoke overtaking the renewal it follows, a client-side retry
// carrying a stale "active" snapshot — and the assertion is the whole point: the tier must follow
// the provider's CURRENT subscription state, never the snapshot embedded in the event, because a
// redelivered event re-sends the snapshot it was built with. See route.ts `currentSubscription`.

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const cap = vi.hoisted(() => ({
  config: null as null | {
    onOrderPaid: (p: unknown) => Promise<void>;
    onSubscriptionRevoked: (p: unknown) => Promise<void>;
    onSubscriptionCanceled: (p: unknown) => Promise<void>;
  },
}));

// In-memory org plan store + the provider's current view of each subscription (the "truth").
const world = vi.hoisted(() => ({
  plans: {} as Record<string, string>,
  provider: {} as Record<string, { status: string; endedAt: Date | null; cancelAtPeriodEnd: boolean }>,
  fetchFails: false,
  fetches: 0,
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
  getCreditState: vi.fn(async (org: string) => ({ balance: 0, plan: world.plans[org] ?? "free", unlimited: false, orgExists: true })),
  grantCredits: vi.fn(async () => 10),
  setOrgPlan: vi.fn(async (org: string, plan: string) => {
    world.plans[org] = plan;
    return true;
  }),
}));
vi.mock("@/lib/polar", () => ({
  creditsForProduct: vi.fn(() => 0),
  planForProduct: vi.fn(() => "pro"),
  getPolar: vi.fn(() => ({
    subscriptions: {
      get: async ({ id }: { id: string }) => {
        world.fetches += 1;
        if (world.fetchFails) throw new Error("polar unreachable");
        const s = world.provider[id];
        if (!s) throw new Error(`no subscription ${id}`);
        return { id, ...s };
      },
    },
  })),
}));

let onOrderPaid: (p: unknown) => Promise<void>;
let onSubscriptionRevoked: (p: unknown) => Promise<void>;
let onSubscriptionCanceled: (p: unknown) => Promise<void>;

beforeAll(async () => {
  process.env.POLAR_WEBHOOK_SECRET = "whsec_test";
  await import("./route");
  onOrderPaid = cap.config!.onOrderPaid;
  onSubscriptionRevoked = cap.config!.onSubscriptionRevoked;
  onSubscriptionCanceled = cap.config!.onSubscriptionCanceled;
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

beforeEach(() => {
  world.plans = { acme: "free" };
  world.provider = { sub1: { status: "active", endedAt: null, cancelAtPeriodEnd: false } };
  world.fetchFails = false;
  world.fetches = 0;
});

const ENDED = new Date("2026-08-15T00:00:00Z");
const bound = { customer: { externalId: "acme" }, metadata: null, productId: "prod_pro" };

/** A renewal `order.paid` whose embedded subscription snapshot is whatever Polar knew when it BUILT the
 *  event (a redelivery re-sends the same snapshot). */
function paid(snapshot: { status: string; endedAt: Date | null } | null, id = "ord1") {
  return onOrderPaid({
    data: { id, ...bound, netAmount: 1000, totalAmount: 1000, refundedAmount: 0, subscriptionId: snapshot ? "sub1" : null, subscription: snapshot },
  });
}
function revoke() {
  world.provider.sub1 = { status: "canceled", endedAt: ENDED, cancelAtPeriodEnd: false };
  return onSubscriptionRevoked({ data: { id: "sub1", ...bound, cancelAtPeriodEnd: false, currentPeriodEnd: ENDED } });
}
function cancel(atPeriodEnd: boolean) {
  world.provider.sub1 = atPeriodEnd
    ? { status: "active", endedAt: null, cancelAtPeriodEnd: true }
    : { status: "canceled", endedAt: ENDED, cancelAtPeriodEnd: false };
  return onSubscriptionCanceled({ data: { id: "sub1", ...bound, cancelAtPeriodEnd: atPeriodEnd, currentPeriodEnd: ENDED } });
}
const ACTIVE = { status: "active", endedAt: null };
const CANCELED = { status: "canceled", endedAt: ENDED };

/** Each sequence: the deliveries in arrival order, and the tier the org is OWED afterwards, read from
 *  the provider's final state (paid-through and cancel-at-period-end still entitle; revoked does not). */
const sequences: { name: string; run: () => Promise<void>; owed: "pro" | "free" }[] = [
  { name: "renewal paid, revoked, then the renewal REDELIVERED with its stale active snapshot", owed: "free",
    run: async () => { await paid(ACTIVE); await revoke(); await paid(ACTIVE); } },
  { name: "revoke overtakes the renewal it followed (out of order): revoked, then paid(active)", owed: "free",
    run: async () => { await revoke(); await paid(ACTIVE); } },
  { name: "paid, immediate cancel, paid redelivered (stale active)", owed: "free",
    run: async () => { await paid(ACTIVE); await cancel(false); await paid(ACTIVE); } },
  { name: "late paid whose OWN snapshot already says canceled (provider agrees)", owed: "free",
    run: async () => { world.provider.sub1 = { ...CANCELED, cancelAtPeriodEnd: false }; await paid(CANCELED); } },
  { name: "provider unreachable on a redelivery after revoke (must retry, never assert the tier)", owed: "free",
    run: async () => { await paid(ACTIVE); await revoke(); world.fetchFails = true; await paid(ACTIVE).catch(() => undefined); } },
  { name: "a single renewal paid, nothing else", owed: "pro",
    run: async () => { await paid(ACTIVE); } },
  { name: "renewal paid twice (plain redelivery, subscription still active)", owed: "pro",
    run: async () => { await paid(ACTIVE); await paid(ACTIVE); } },
  { name: "paid, cancel-at-period-end scheduled, paid redelivered (still paid through the period)", owed: "pro",
    run: async () => { await paid(ACTIVE); await cancel(true); await paid(ACTIVE); } },
  { name: "one-time plan order with no subscription", owed: "pro",
    run: async () => { await paid(null); } },
];

describe("lifecycle replay — the tier follows the provider's CURRENT state, not the event snapshot", () => {
  it("leaves no sequence on a tier the org is not owed", async () => {
    const wrong: string[] = [];
    for (const s of sequences) {
      world.plans = { acme: "free" };
      world.provider = { sub1: { status: "active", endedAt: null, cancelAtPeriodEnd: false } };
      world.fetchFails = false;
      await s.run();
      if (world.plans.acme !== s.owed) wrong.push(`${s.name}: got ${world.plans.acme}, owed ${s.owed}`);
    }
    // Printed so a failing run shows the count with its predicate, not just "expected [] to equal []".
    console.log(`[replay] ${wrong.length}/${sequences.length} sequences on a tier not owed`, wrong);
    expect(wrong).toEqual([]);
  });

  it("a redelivery after revoke reads the subscription from Polar and does NOT re-grant", async () => {
    await paid(ACTIVE);
    expect(world.plans.acme).toBe("pro");
    await revoke();
    expect(world.plans.acme).toBe("free");
    await paid(ACTIVE);
    expect(world.plans.acme).toBe("free");
    expect(world.fetches).toBeGreaterThan(0);
  });

  it("THROWS (so Polar retries) when the subscription cannot be read, rather than trusting the snapshot", async () => {
    world.fetchFails = true;
    await expect(paid(ACTIVE)).rejects.toThrow(/could not read subscription/);
    expect(world.plans.acme).toBe("free");
  });
});
