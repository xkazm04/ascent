import { afterEach, describe, expect, it } from "vitest";
import { creditPacks, creditsForProduct, polarEnabled, polarServer } from "./polar";

const PACKS = process.env.POLAR_CREDIT_PACKS;
const SERVER = process.env.POLAR_SERVER;
const TOKEN = process.env.POLAR_ACCESS_TOKEN;

afterEach(() => {
  // Restore whatever the runner started with (delete = was unset).
  for (const [k, v] of [
    ["POLAR_CREDIT_PACKS", PACKS],
    ["POLAR_SERVER", SERVER],
    ["POLAR_ACCESS_TOKEN", TOKEN],
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
  it("requires both a token and at least one pack", () => {
    process.env.POLAR_ACCESS_TOKEN = "polar_sandbox_xxx";
    process.env.POLAR_CREDIT_PACKS = "prod_a=100";
    expect(polarEnabled()).toBe(true);

    delete process.env.POLAR_ACCESS_TOKEN;
    expect(polarEnabled()).toBe(false);

    process.env.POLAR_ACCESS_TOKEN = "polar_sandbox_xxx";
    delete process.env.POLAR_CREDIT_PACKS;
    expect(polarEnabled()).toBe(false);
  });
});
