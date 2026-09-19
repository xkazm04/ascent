import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(async () => ({ customerPortalUrl: "https://polar.test/portal/sess" })),
}));

vi.mock("@polar-sh/sdk", () => ({
  Polar: class Polar {
    customerSessions = { create: mockCreate };
  },
}));

import {
  creditPacks,
  creditsForProduct,
  planForProduct,
  planProducts,
  polarCustomerPortalUrl,
  polarEnabled,
  polarHostedPortalUrl,
  polarServer,
} from "./polar";

const PACKS = process.env.POLAR_CREDIT_PACKS;
const PLAN_PRODUCTS = process.env.POLAR_PLAN_PRODUCTS;
const SERVER = process.env.POLAR_SERVER;
const TOKEN = process.env.POLAR_ACCESS_TOKEN;
const ORG_SLUG = process.env.POLAR_ORGANIZATION_SLUG;

afterEach(() => {
  // Restore whatever the runner started with (delete = was unset).
  for (const [k, v] of [
    ["POLAR_CREDIT_PACKS", PACKS],
    ["POLAR_PLAN_PRODUCTS", PLAN_PRODUCTS],
    ["POLAR_SERVER", SERVER],
    ["POLAR_ACCESS_TOKEN", TOKEN],
    ["POLAR_ORGANIZATION_SLUG", ORG_SLUG],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("creditPacks", () => {
  it("parses <productId>=<credits> pairs, trims whitespace, preserves order", () => {
    process.env.POLAR_CREDIT_PACKS = "prod_a=100, prod_b=500 , prod_c=2000";
    expect(creditPacks()).toEqual([
      { productId: "prod_a", credits: 100, label: "100 credits" },
      { productId: "prod_b", credits: 500, label: "500 credits" },
      { productId: "prod_c", credits: 2000, label: "2,000 credits" },
    ]);
  });

  it("skips malformed, zero, negative, and non-numeric entries", () => {
    process.env.POLAR_CREDIT_PACKS = "bad,prod_x=0,prod_y=-5,prod_z=abc,prod_ok=50,prod_frac=1.5";
    expect(creditPacks().map((p) => p.productId)).toEqual(["prod_ok"]);
  });

  it("is empty when unset", () => {
    delete process.env.POLAR_CREDIT_PACKS;
    expect(creditPacks()).toEqual([]);
  });
});

describe("creditsForProduct", () => {
  it("maps a known product to its credits, else 0", () => {
    process.env.POLAR_CREDIT_PACKS = "prod_a=100,prod_b=500";
    expect(creditsForProduct("prod_a")).toBe(100);
    expect(creditsForProduct("prod_b")).toBe(500);
    expect(creditsForProduct("nope")).toBe(0);
    expect(creditsForProduct(null)).toBe(0);
    expect(creditsForProduct(undefined)).toBe(0);
  });
});

describe("planProducts", () => {
  it("parses <productId>=<planId> pairs, trims whitespace, preserves order", () => {
    process.env.POLAR_PLAN_PRODUCTS = "prod_pro=pro, prod_team=team , prod_ent=enterprise";
    expect(planProducts()).toEqual([
      { productId: "prod_pro", plan: "pro" },
      { productId: "prod_team", plan: "team" },
      { productId: "prod_ent", plan: "enterprise" },
    ]);
  });

  it("skips entries whose plan isn't a known PlanId", () => {
    process.env.POLAR_PLAN_PRODUCTS = "bad,prod_x=gold,prod_y=,=team,prod_ok=pro";
    expect(planProducts().map((p) => p.productId)).toEqual(["prod_ok"]);
  });

  it("is empty when unset", () => {
    delete process.env.POLAR_PLAN_PRODUCTS;
    expect(planProducts()).toEqual([]);
  });
});

describe("planForProduct", () => {
  it("maps a known product to its plan tier, else null", () => {
    process.env.POLAR_PLAN_PRODUCTS = "prod_pro=pro,prod_team=team";
    expect(planForProduct("prod_pro")).toBe("pro");
    expect(planForProduct("prod_team")).toBe("team");
    expect(planForProduct("nope")).toBeNull();
    expect(planForProduct(null)).toBeNull();
    expect(planForProduct(undefined)).toBeNull();
  });
});

describe("polarServer", () => {
  it("defaults to sandbox; production only when explicitly set", () => {
    delete process.env.POLAR_SERVER;
    expect(polarServer()).toBe("sandbox");
    process.env.POLAR_SERVER = "production";
    expect(polarServer()).toBe("production");
    process.env.POLAR_SERVER = "anything-else";
    expect(polarServer()).toBe("sandbox");
  });
});

describe("polarEnabled", () => {
  it("requires a token AND at least one sellable product (credit pack or plan tier)", () => {
    process.env.POLAR_ACCESS_TOKEN = "polar_sandbox_xxx";
    process.env.POLAR_CREDIT_PACKS = "prod_a=100";
    delete process.env.POLAR_PLAN_PRODUCTS;
    expect(polarEnabled()).toBe(true);

    // No token → never enabled, even with a pack configured.
    delete process.env.POLAR_ACCESS_TOKEN;
    expect(polarEnabled()).toBe(false);

    // Token but NOTHING sellable (no packs, no plan products) → disabled.
    process.env.POLAR_ACCESS_TOKEN = "polar_sandbox_xxx";
    delete process.env.POLAR_CREDIT_PACKS;
    delete process.env.POLAR_PLAN_PRODUCTS;
    expect(polarEnabled()).toBe(false);
  });

  it("is enabled for a subscription-ONLY deployment — plan products but no credit packs", () => {
    // The bug this guards: gating on credit packs ALONE 503'd checkout and hid billing on a deployment
    // that sells plan-tier subscriptions but no à-la-carte credit packs.
    process.env.POLAR_ACCESS_TOKEN = "polar_sandbox_xxx";
    delete process.env.POLAR_CREDIT_PACKS;
    process.env.POLAR_PLAN_PRODUCTS = "prod_pro=pro";
    expect(polarEnabled()).toBe(true);
  });
});

describe("polarHostedPortalUrl", () => {
  it("builds Polar's documented hosted portal; production vs sandbox host", () => {
    delete process.env.POLAR_SERVER;
    expect(polarHostedPortalUrl("ascent")).toBe("https://sandbox.polar.sh/ascent/portal");
    process.env.POLAR_SERVER = "production";
    expect(polarHostedPortalUrl("ascent")).toBe("https://polar.sh/ascent/portal");
  });

  it("is null for a blank slug", () => {
    expect(polarHostedPortalUrl("")).toBeNull();
    expect(polarHostedPortalUrl("   ")).toBeNull();
  });
});

describe("polarCustomerPortalUrl", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({ customerPortalUrl: "https://polar.test/portal/sess" });
    process.env.POLAR_ACCESS_TOKEN = "polar_sandbox_xxx";
    process.env.POLAR_PLAN_PRODUCTS = "prod_pro=pro";
    delete process.env.POLAR_CREDIT_PACKS;
    delete process.env.POLAR_ORGANIZATION_SLUG;
    delete process.env.POLAR_SERVER;
  });

  it("returns null when Polar is absent (free / self-host) and never mints a session", async () => {
    delete process.env.POLAR_ACCESS_TOKEN;
    delete process.env.POLAR_PLAN_PRODUCTS;
    expect(await polarCustomerPortalUrl("acme")).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns null for a blank external customer id even when Polar is present", async () => {
    expect(await polarCustomerPortalUrl("  ")).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("mints a Polar customer session keyed by the org's externalCustomerId when Polar is present", async () => {
    expect(await polarCustomerPortalUrl("acme", { returnUrl: "https://ascent.test/org/acme" })).toBe(
      "https://polar.test/portal/sess",
    );
    expect(mockCreate).toHaveBeenCalledWith({
      externalCustomerId: "acme",
      returnUrl: "https://ascent.test/org/acme",
    });
  });

  it("falls back to the documented hosted portal when the session API fails and a Polar org slug is set", async () => {
    mockCreate.mockRejectedValue(new Error("customer not found"));
    process.env.POLAR_ORGANIZATION_SLUG = "ascent";
    expect(await polarCustomerPortalUrl("acme")).toBe("https://sandbox.polar.sh/ascent/portal");
  });

  it("returns null when Polar is present but no session URL and no hosted-portal slug", async () => {
    mockCreate.mockRejectedValue(new Error("customer not found"));
    expect(await polarCustomerPortalUrl("acme")).toBeNull();
  });
});
