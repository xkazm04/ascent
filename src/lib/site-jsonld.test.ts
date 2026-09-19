// Pins the site-wide JSON-LD graph (src/lib/site-jsonld.ts, inlined by src/app/layout.tsx).
//
// The root layout used to emit SoftwareApplication.offers = { price: "0" }. That is a site-wide
// claim that the product is free — Google rich results show the lowest Offer price — while /pricing
// sells Starter/Team subscriptions from planPriceLabel(). G8 keeps those prices numeric, anonymous,
// and one-click; a zero Offer on every page is the opposite claim.
//
// The contract:
//   1. jsonLdOfferPrice accepts only paid "$N" amounts from planPriceLabel (not $0, not "Flexible").
//   2. siteStructuredData's graph never has price/lowPrice/highPrice of 0, nor isAccessibleForFree.
//   3. Offer prices equal the numeric planPriceLabel amounts for subscription tiers.
//   4. The root layout inlines siteStructuredData() and does not re-type a zero Offer.
//
// TokenNotice recovery and global-error "Try again" are pinned in their own suites; this file does
// not touch those surfaces.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { PLAN_FEATURES, PLAN_ORDER, planPriceLabel } from "@/lib/plans";
import { jsonLdScript } from "@/lib/site";
import { jsonLdOfferPrice, siteJsonLdOffers, siteStructuredData } from "./site-jsonld";

function walk(node: unknown, visit: (o: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) {
    for (const x of node) walk(x, visit);
    return;
  }
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    visit(o);
    for (const v of Object.values(o)) walk(v, visit);
  }
}

function isZeroPrice(v: unknown): boolean {
  if (typeof v === "number") return v === 0;
  if (typeof v === "string" && v.trim() !== "") return Number(v) === 0;
  return false;
}

function paidPlanPrices(): Map<string, string> {
  const out = new Map<string, string>();
  for (const id of PLAN_ORDER) {
    const price = jsonLdOfferPrice(planPriceLabel(id).amount);
    if (price != null) out.set(PLAN_FEATURES[id].label, price);
  }
  return out;
}

function walkFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name.includes(".test.")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkFiles(p, acc);
    else if (/\.(ts|tsx)$/.test(name)) acc.push(p);
  }
  return acc;
}

describe("jsonLdOfferPrice — paid numbers only", () => {
  it("strips the $ from a paid planPriceLabel amount", () => {
    expect(jsonLdOfferPrice(planPriceLabel("pro").amount)).toBe("5");
    expect(jsonLdOfferPrice(planPriceLabel("team").amount)).toBe("10");
    expect(jsonLdOfferPrice("$5")).toBe("5");
    expect(jsonLdOfferPrice("$10")).toBe("10");
  });

  it("rejects the free tier's $0 and the Custom tier's Flexible", () => {
    expect(jsonLdOfferPrice(planPriceLabel("free").amount)).toBeNull();
    expect(jsonLdOfferPrice(planPriceLabel("enterprise").amount)).toBeNull();
    expect(jsonLdOfferPrice("$0")).toBeNull();
    expect(jsonLdOfferPrice("$0.00")).toBeNull();
    expect(jsonLdOfferPrice("Flexible")).toBeNull();
  });
});

describe("siteJsonLdOffers — G8 numeric anonymous paid plans", () => {
  it("emits Starter and Team from planPriceLabel, never Free or Custom", () => {
    const agg = siteJsonLdOffers("https://ascent.dev");
    expect(agg).toBeDefined();
    expect(agg!["@type"]).toBe("AggregateOffer");
    const expected = paidPlanPrices();
    expect(new Set(agg!.offers.map((o) => o.name))).toEqual(new Set(expected.keys()));
    for (const o of agg!.offers) {
      expect(o.price).toBe(expected.get(o.name));
      expect(o.priceCurrency).toBe("USD");
      expect(Number(o.price)).toBeGreaterThan(0);
    }
    const nums = [...expected.values()].map(Number);
    expect(agg!.offerCount).toBe(expected.size);
    expect(agg!.lowPrice).toBe(String(Math.min(...nums)));
    expect(agg!.highPrice).toBe(String(Math.max(...nums)));
    expect(agg!.url).toBe("https://ascent.dev/pricing");
  });

  it("omits the pricing URL when no public base is configured", () => {
    expect(siteJsonLdOffers("")?.url).toBeUndefined();
  });
});

describe("siteStructuredData — 0 site-wide claims the product is free", () => {
  it("never sets isAccessibleForFree or a zero price/lowPrice/highPrice", () => {
    const data = siteStructuredData("https://ascent.dev");
    const zeros: string[] = [];
    walk(data, (o) => {
      if (o.isAccessibleForFree === true || o.isAccessibleForFree === "true") {
        zeros.push("isAccessibleForFree");
      }
      for (const key of ["price", "lowPrice", "highPrice"] as const) {
        if (isZeroPrice(o[key])) zeros.push(`${key}=${String(o[key])}`);
      }
    });
    expect(zeros).toEqual([]);
  });

  it("serialized JSON-LD has no free-product Offer markers", () => {
    const out = jsonLdScript(siteStructuredData("https://ascent.dev"));
    expect(out).not.toMatch(/"price"\s*:\s*"?0(?:\.0+)?"?/);
    expect(out).not.toMatch(/"lowPrice"\s*:\s*"?0(?:\.0+)?"?/);
    expect(out).not.toMatch(/"highPrice"\s*:\s*"?0(?:\.0+)?"?/);
    expect(out).not.toMatch(/"isAccessibleForFree"\s*:\s*true/);
  });

  it("SoftwareApplication offers match paid planPriceLabel amounts", () => {
    const data = siteStructuredData("https://ascent.dev");
    const graph = (data["@graph"] as Array<Record<string, unknown>>).find(
      (n) => n["@type"] === "SoftwareApplication",
    );
    expect(graph).toBeDefined();
    const offers = graph!.offers as { offers: Array<{ name: string; price: string }> };
    const expected = paidPlanPrices();
    expect(offers.offers.map((o) => [o.name, o.price])).toEqual([...expected.entries()]);
  });
});

describe("root layout inlines the helper, not a typed-zero Offer", () => {
  it("src/app/layout.tsx calls siteStructuredData and has no zero-price Offer", () => {
    const src = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(src).toMatch(/from ["']@\/lib\/site-jsonld["']/);
    expect(src).toMatch(/siteStructuredData/);
    expect(src).toMatch(/jsonLdScript\(STRUCTURED_DATA\)/);
    expect(src).not.toMatch(/price:\s*["']0["']/);
    expect(src).not.toMatch(/isAccessibleForFree/);
  });

  it("no src/app JSON-LD inliner claims the product is free", () => {
    const hits: string[] = [];
    for (const f of walkFiles(join(process.cwd(), "src/app"))) {
      const src = readFileSync(f, "utf8");
      if (!src.includes("application/ld+json") && !src.includes("siteStructuredData")) continue;
      if (/isAccessibleForFree\s*:\s*true/.test(src)) hits.push(`${f}: isAccessibleForFree`);
      if (/price:\s*["']0["']/.test(src)) hits.push(`${f}: price 0`);
    }
    expect(hits).toEqual([]);
  });
});
