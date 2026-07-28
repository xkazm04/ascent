// G1-01: Pro/Team "Get started" used to link to /onboarding unconditionally — a visitor who wants to
// buy a subscription tier had no in-app path to pay, even though the backend fully supports Polar
// plan-tier checkout (planForProduct / setOrgPlan / planProducts()). Pins the CTA decision:
// - Polar configured + a resolvable org + a plan-product mapping → a real checkout link.
// - Any of those missing (Polar unconfigured, no plan-product mapping, no org yet) → the old, working
//   /onboarding fallback, never a dead button.
// Free/Enterprise CTAs are unchanged; pinned here too so the refactor didn't disturb them.

import { describe, it, expect } from "vitest";
import { ctaFor } from "./page";

describe("pricing CTA — plan-tier checkout reachability (G1-01)", () => {
  it("free always scans, regardless of org/product state", () => {
    expect(ctaFor("free", null, undefined)).toEqual({ href: "/", label: "Scan a repo free" });
    expect(ctaFor("free", "acme", "prod_pro")).toEqual({ href: "/", label: "Scan a repo free" });
  });

  it("enterprise falls back to Learn more when no contact email is configured", () => {
    expect(ctaFor("enterprise", "acme", "prod_ent")).toEqual({ href: "/about", label: "Learn more" });
  });

  it("pro/team become a real checkout link when Polar is configured and the org is known", () => {
    expect(ctaFor("pro", "acme", "prod_pro")).toEqual({
      href: "/api/billing/checkout?org=acme&pack=prod_pro",
      label: "Subscribe",
    });
    expect(ctaFor("team", "acme", "prod_team")).toEqual({
      href: "/api/billing/checkout?org=acme&pack=prod_team",
      label: "Subscribe",
    });
  });

  it("degrades to /onboarding when there is no resolvable org (anonymous visitor, or signed in with no org yet)", () => {
    expect(ctaFor("pro", null, "prod_pro")).toEqual({ href: "/onboarding", label: "Get started" });
  });

  it("degrades to /onboarding when Polar has no plan-product mapping for the tier (unconfigured deployment)", () => {
    expect(ctaFor("pro", "acme", undefined)).toEqual({ href: "/onboarding", label: "Get started" });
  });

  it("encodes org and product ids in the checkout URL", () => {
    const cta = ctaFor("team", "my org/slug", "prod team");
    expect(cta.href).toBe("/api/billing/checkout?org=my%20org%2Fslug&pack=prod%20team");
  });
});
