// Price-drift reconciliation (src/lib/price-drift.ts) — the automated check behind the PRICE
// CONTRACT in plans.ts (display `monthlyPrice` vs the live Polar price book). What must hold:
//   • cents→USD comparison against the plan's advertised whole-dollar price, reading ONLY a
//     non-archived fixed USD price off the product's wide price union (free/custom/metered/seat
//     legs and archived or foreign-currency fixed prices never masquerade as the live price);
//   • custom-priced tiers (the Custom tier, monthlyPrice null) are exempt — "Flexible" can't drift;
//   • unset Polar env → null ("not configured"), distinct from {checked, no mismatches};
//   • one product's fetch failure lands in `errors` (NOT `mismatches` — a network blip is not a
//     price change) and never aborts the remaining products.
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

import { checkPriceDrift, comparePlanPrice, productMonthlyUsd, type PriceSource } from "./price-drift";

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

describe("comparePlanPrice — lockstep vs drift", () => {
  it("in lockstep → null (pro advertises $10; Polar charges 1000 cents)", () => {
    expect(comparePlanPrice("pro", "prod_pro", { prices: [fixedUsd(1000)] })).toBeNull();
  });

  it("drifted → reports both sides (team advertises $20; Polar now charges $25)", () => {
    expect(comparePlanPrice("team", "prod_team", { prices: [fixedUsd(2500)] })).toEqual({
      plan: "team",
      productId: "prod_team",
      displayUsd: 20,
      polarUsd: 25,
    });
  });

  it("a product with NO comparable fixed price is drift with polarUsd null (still surfaced)", () => {
    expect(comparePlanPrice("pro", "prod_pro", { prices: [{ amountType: "free" }] })).toEqual({
      plan: "pro",
      productId: "prod_pro",
      displayUsd: 10,
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
      prod_pro: { prices: [fixedUsd(1000)] },
      prod_team: { prices: [fixedUsd(2000)] },
    });
    await expect(checkPriceDrift(client)).resolves.toEqual({ checked: 2, mismatches: [], errors: [] });
  });

  it("reports only the drifted product; in-lockstep ones stay silent", async () => {
    mockPlanProducts.mockReturnValue([
      { productId: "prod_pro", plan: "pro" },
      { productId: "prod_team", plan: "team" },
    ]);
    const client = stubClient({
      prod_pro: { prices: [fixedUsd(1000)] }, // lockstep
      prod_team: { prices: [fixedUsd(2900)] }, // drifted: $29 vs advertised $20
    });
    const report = await checkPriceDrift(client);
    expect(report!.checked).toBe(2);
    expect(report!.mismatches).toEqual([{ plan: "team", productId: "prod_team", displayUsd: 20, polarUsd: 29 }]);
    expect(report!.errors).toEqual([]);
  });

  it("one product's fetch failure → errors[] entry, NOT a mismatch, and the rest still checked", async () => {
    mockPlanProducts.mockReturnValue([
      { productId: "prod_pro", plan: "pro" },
      { productId: "prod_team", plan: "team" },
    ]);
    const client = stubClient({ prod_team: { prices: [fixedUsd(2000)] } }, ["prod_pro"]);
    const report = await checkPriceDrift(client);
    expect(report!.checked).toBe(1); // team fetched + compared despite pro failing
    expect(report!.mismatches).toEqual([]);
    expect(report!.errors).toHaveLength(1);
    expect(report!.errors[0]).toContain("prod_pro");
  });
});
