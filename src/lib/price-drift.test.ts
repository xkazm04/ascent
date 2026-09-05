// Price-drift reconciliation (src/lib/price-drift.ts) — the automated check behind the PRICE
// CONTRACT in plans.ts (display `monthlyPrice` vs the live Polar price book). What must hold:
//   • cents→USD comparison against the plan's advertised whole-dollar price, reading ONLY a
//     non-archived fixed USD price off the product's wide price union (free/custom/metered/seat
//     legs and archived or foreign-currency fixed prices never masquerade as the live price);
//   • custom-priced tiers (the Custom tier, monthlyPrice null) are exempt — "Flexible" can't drift;
//   • unset Polar env → null ("not configured"), distinct from {checked, no mismatches};
//   • one product's fetch failure lands in `errors` (NOT `mismatches` — a network blip is not a
//     price change) and never aborts the remaining products, and the report's `status` reads
//     "unknown" rather than "ok" whenever anything failed to fetch;
//   • the OFFLINE half — the advertised prices still match RECORDED_PRICE_BOOK, the dated transcript
//     of what Polar charged when someone last looked. That assertion is the one that runs on every
//     build, which is what turned this module from a detector nobody watched into a check that fails
//     in front of whoever changed the price.
// @/lib/polar is mocked so the catalog and client are driven per-test with no network.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetPolar, mockPlanProducts } = vi.hoisted(() => ({
  mockGetPolar: vi.fn(() => null),
  mockPlanProducts: vi.fn(() => [] as { productId: string; plan: string }[]),
}));

vi.mock("@/lib/polar", () => ({
  getPolar: mockGetPolar,
  planProducts: mockPlanProducts,
}));

import {
  checkPriceDrift,
  checkRecordedPriceBook,
  comparePlanPrice,
  productMonthlyUsd,
  RECORDED_PRICE_BOOK,
  type PriceSource,
} from "./price-drift";
import { PLAN_FEATURES, PLAN_ORDER } from "./plans";

/** A stub client whose product map is driven per-test. */
function stubClient(products: Record<string, { prices?: unknown[] }>, failFor: string[] = []): PriceSource {
  return {
    products: {
      get: vi.fn(async ({ id }: { id: string }) => {
        if (failFor.includes(id)) throw new Error(`polar 500 for ${id}`);
        const p = products[id];
        if (!p) throw new Error(`unknown product ${id}`);
        return p;
      }),
    },
  };
}

const fixedUsd = (cents: number, extra: Record<string, unknown> = {}) => ({
  amountType: "fixed",
  priceAmount: cents,
  priceCurrency: "usd",
  isArchived: false,
  ...extra,
});

beforeEach(() => {
  mockGetPolar.mockReset().mockReturnValue(null);
  mockPlanProducts.mockReset().mockReturnValue([]);
});

describe("productMonthlyUsd — extracting the live price from the price union", () => {
  it("reads a fixed USD price and converts cents → USD", () => {
    expect(productMonthlyUsd({ prices: [fixedUsd(1000)] })).toBe(10);
  });

  it("skips free/custom/metered legs (no priceAmount to compare)", () => {
    expect(
      productMonthlyUsd({ prices: [{ amountType: "free" }, { amountType: "custom" }, { amountType: "metered_unit" }] }),
    ).toBeNull();
  });

  it("skips an ARCHIVED fixed price — a retired price is not the live one", () => {
    expect(productMonthlyUsd({ prices: [fixedUsd(500, { isArchived: true }), fixedUsd(1000)] })).toBe(10);
  });

  it("skips a foreign-currency fixed price (a EUR amount is not the USD display price)", () => {
    expect(productMonthlyUsd({ prices: [fixedUsd(900, { priceCurrency: "eur" })] })).toBeNull();
  });

  it("tolerates a missing/empty/malformed prices array", () => {
    expect(productMonthlyUsd({})).toBeNull();
    expect(productMonthlyUsd({ prices: [] })).toBeNull();
    expect(productMonthlyUsd({ prices: [null, 42, "x"] })).toBeNull();
  });
});

// Cents Polar would have to charge for a tier to be in lockstep with what plans.ts advertises. Derived
// so a REPRICING never breaks these tests: they are about the drift SEMANTICS, not about any particular
// dollar figure — and hardcoding the advertised side made every one of them a second place to edit on a
// price change (which is exactly what the 2026-08-14 repricing hit).
const advertised = (plan: "pro" | "team") => PLAN_FEATURES[plan].monthlyPrice!;
const lockstepCents = (plan: "pro" | "team") => advertised(plan) * 100;

describe("comparePlanPrice — lockstep vs drift", () => {
  it("in lockstep → null (Polar charges exactly what plans.ts advertises)", () => {
    expect(comparePlanPrice("pro", "prod_pro", { prices: [fixedUsd(lockstepCents("pro"))] })).toBeNull();
  });

  it("drifted → reports both sides (Polar charges $5 more than advertised)", () => {
    const polarUsd = advertised("team") + 5;
    expect(comparePlanPrice("team", "prod_team", { prices: [fixedUsd(polarUsd * 100)] })).toEqual({
      plan: "team",
      productId: "prod_team",
      displayUsd: advertised("team"),
      polarUsd,
    });
  });

  it("a product with NO comparable fixed price is drift with polarUsd null (still surfaced)", () => {
    expect(comparePlanPrice("pro", "prod_pro", { prices: [{ amountType: "free" }] })).toEqual({
      plan: "pro",
      productId: "prod_pro",
      displayUsd: advertised("pro"),
      polarUsd: null,
    });
  });

  it("the Custom tier (monthlyPrice null → 'Flexible') is exempt — no number exists to drift", () => {
    expect(comparePlanPrice("enterprise", "prod_ent", { prices: [fixedUsd(99900)] })).toBeNull();
  });
});

describe("checkPriceDrift — the operational sweep", () => {
  it("returns null when Polar has no client (env unset) even with a catalog", async () => {
    mockPlanProducts.mockReturnValue([{ productId: "prod_pro", plan: "pro" }]);
    await expect(checkPriceDrift()).resolves.toBeNull();
  });

  it("returns null when POLAR_PLAN_PRODUCTS maps nothing (credit-only deployment)", async () => {
    await expect(checkPriceDrift(stubClient({}))).resolves.toBeNull();
  });

  it("clean lockstep run → checked count, empty mismatches/errors (NOT null)", async () => {
    mockPlanProducts.mockReturnValue([
      { productId: "prod_pro", plan: "pro" },
      { productId: "prod_team", plan: "team" },
    ]);
    const client = stubClient({
      prod_pro: { prices: [fixedUsd(lockstepCents("pro"))] },
      prod_team: { prices: [fixedUsd(lockstepCents("team"))] },
    });
    await expect(checkPriceDrift(client)).resolves.toEqual({ checked: 2, mismatches: [], errors: [], status: "ok" });
  });

  it("reports only the drifted product; in-lockstep ones stay silent", async () => {
    mockPlanProducts.mockReturnValue([
      { productId: "prod_pro", plan: "pro" },
      { productId: "prod_team", plan: "team" },
    ]);
    const driftedUsd = advertised("team") + 19;
    const client = stubClient({
      prod_pro: { prices: [fixedUsd(lockstepCents("pro"))] }, // lockstep
      prod_team: { prices: [fixedUsd(driftedUsd * 100)] }, // drifted
    });
    const report = await checkPriceDrift(client);
    expect(report!.checked).toBe(2);
    expect(report!.mismatches).toEqual([
      { plan: "team", productId: "prod_team", displayUsd: advertised("team"), polarUsd: driftedUsd },
    ]);
    expect(report!.errors).toEqual([]);
  });

  it("one product's fetch failure → errors[] entry, NOT a mismatch, and the rest still checked", async () => {
    mockPlanProducts.mockReturnValue([
      { productId: "prod_pro", plan: "pro" },
      { productId: "prod_team", plan: "team" },
    ]);
    const client = stubClient({ prod_team: { prices: [fixedUsd(lockstepCents("team"))] } }, ["prod_pro"]);
    const report = await checkPriceDrift(client);
    expect(report!.checked).toBe(1); // team fetched + compared despite pro failing
    expect(report!.mismatches).toEqual([]);
    expect(report!.errors).toHaveLength(1);
    expect(report!.errors[0]).toContain("prod_pro");
  });
});

// The build-time half of the PRICE CONTRACT. The live sweep above only runs where Polar is reachable
// — never in CI — so on its own it was a safeguard nobody watched: a display price could be edited
// (or a Polar price changed and not mirrored) and nothing would object until an operator happened to
// open GET /api/kpi. THIS is the assertion that fails in front of someone, on every build, offline.
describe("the recorded price book — the check that actually runs (item 14)", () => {
  it("every advertised price matches the last price recorded off Polar", () => {
    // If this fails: someone changed an advertised price without recording what the price book says.
    // Fix by verifying the Polar dashboard and updating RECORDED_PRICE_BOOK (cents + recordedAt) —
    // NOT by copying `monthlyPrice` into it, which would defeat the whole point.
    expect(checkRecordedPriceBook()).toEqual([]);
  });

  it("covers every tier, so a NEW tier cannot slip in unpriced", () => {
    expect(Object.keys(RECORDED_PRICE_BOOK).sort()).toEqual([...PLAN_ORDER].sort());
  });

  it("records cents (Polar's unit) and a date, so the evidence carries its own age", () => {
    for (const plan of PLAN_ORDER) {
      const rec = RECORDED_PRICE_BOOK[plan];
      expect(rec.recordedAt, plan).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (rec.cents != null) expect(Number.isInteger(rec.cents), plan).toBe(true);
    }
  });

  it("catches a one-sided edit: a display price moved without re-reading the price book", () => {
    // The exact failure this check exists for. The advertised side is injected, so the assertion
    // exercises the FAILING path of the same function CI runs in its passing state.
    const drifted = checkRecordedPriceBook((plan) =>
      plan === "team" ? (PLAN_FEATURES.team.monthlyPrice ?? 0) + 7 : PLAN_FEATURES[plan].monthlyPrice,
    );
    expect(drifted).toEqual([
      {
        plan: "team",
        displayUsd: PLAN_FEATURES.team.monthlyPrice! + 7,
        recordedUsd: RECORDED_PRICE_BOOK.team.cents! / 100,
        recordedAt: RECORDED_PRICE_BOOK.team.recordedAt,
      },
    ]);
  });

  it("catches the Custom tier growing a price it cannot have (recorded: no fixed price)", () => {
    const drifted = checkRecordedPriceBook((plan) => (plan === "enterprise" ? 999 : PLAN_FEATURES[plan].monthlyPrice));
    expect(drifted.map((m) => m.plan)).toEqual(["enterprise"]);
    expect(drifted[0].recordedUsd).toBeNull();
  });
});

// A failed fetch must never read as "no drift". `mismatches.length === 0` is TRUE during a total
// outage, so any consumer keying on it alone reports a healthy price book while knowing nothing.
describe("checkPriceDrift status — an outage is 'unknown', not 'ok'", () => {
  it("a clean, complete sweep is 'ok'", async () => {
    mockPlanProducts.mockReturnValue([{ productId: "prod_pro", plan: "pro" }]);
    const report = await checkPriceDrift(stubClient({ prod_pro: { prices: [fixedUsd(lockstepCents("pro"))] } }));
    expect(report!.status).toBe("ok");
  });

  it("a total outage is 'unknown' even though mismatches is empty", async () => {
    mockPlanProducts.mockReturnValue([
      { productId: "prod_pro", plan: "pro" },
      { productId: "prod_team", plan: "team" },
    ]);
    const report = await checkPriceDrift(stubClient({}, ["prod_pro", "prod_team"]));
    expect(report!.mismatches).toEqual([]); // the trap
    expect(report!.checked).toBe(0);
    expect(report!.status).toBe("unknown");
  });

  it("a partial outage with no mismatch among the fetched products is still 'unknown'", async () => {
    mockPlanProducts.mockReturnValue([
      { productId: "prod_pro", plan: "pro" },
      { productId: "prod_team", plan: "team" },
    ]);
    const report = await checkPriceDrift(stubClient({ prod_team: { prices: [fixedUsd(lockstepCents("team"))] } }, ["prod_pro"]));
    expect(report!.status).toBe("unknown");
  });

  it("a confirmed mismatch outranks an outage — 'drift' is the actionable answer", async () => {
    mockPlanProducts.mockReturnValue([
      { productId: "prod_pro", plan: "pro" },
      { productId: "prod_team", plan: "team" },
    ]);
    const client = stubClient({ prod_team: { prices: [fixedUsd((advertised("team") + 3) * 100)] } }, ["prod_pro"]);
    const report = await checkPriceDrift(client);
    expect(report!.errors).toHaveLength(1);
    expect(report!.status).toBe("drift");
  });
});
