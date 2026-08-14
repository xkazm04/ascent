// G1-01: the paid tiers' "Get started" used to link to /onboarding unconditionally — a visitor who wants to
// buy a subscription tier had no in-app path to pay, even though the backend fully supports Polar
// plan-tier checkout (planForProduct / setOrgPlan / planProducts()). Pins the CTA decision:
// - Polar configured + a resolvable org + a plan-product mapping → a real checkout link.
// - Any of those missing (Polar unconfigured, no plan-product mapping, no org yet) → the old, working
//   /onboarding fallback, never a dead button.
// The Free CTA is unchanged; pinned here too so the refactor didn't disturb it. The bespoke tier
// (stored `enterprise`, shown as "Custom") now returns NULL — it has no destination at all, because its
// CTA opens the enquiry dialog instead of navigating. That replaced a `mailto:` that only existed when
// ASCENT_CONTACT_EMAIL was set and a "Learn more" → /about link when it wasn't.

import { describe, it, expect } from "vitest";
import { ctaFor } from "./page";
import { PLAN_FEATURES } from "@/lib/plans";

describe("pricing CTA — plan-tier checkout reachability (G1-01)", () => {
  it("free always scans, regardless of org/product state", () => {
    expect(ctaFor("free", null, undefined)).toEqual({ href: "/", label: "Scan a repo free" });
    expect(ctaFor("free", "acme", "prod_pro")).toEqual({ href: "/", label: "Scan a repo free" });
  });

  it("the bespoke tier has no href — its CTA opens the enquiry dialog", () => {
    expect(ctaFor("enterprise", "acme", "prod_ent")).toBeNull();
    // Even with a plan-product mapping AND a resolvable org, it must NOT become a checkout link: the
    // price is negotiated, so a Polar product mapped to this tier is an operator's manual fulfilment
    // path, not something a visitor may buy from the page.
    expect(ctaFor("enterprise", null, undefined)).toBeNull();
  });

  it("decides 'no destination' from the BILLING MODEL, not the literal tier id", () => {
    // Guards the rename: the tier is stored as `enterprise` and shown as "Custom", and a future
    // relabel must not silently restore a checkout link on a tier that can't be bought.
    for (const p of Object.values(PLAN_FEATURES)) {
      if (p.billing === "custom") expect(ctaFor(p.id, "acme", "prod_x")).toBeNull();
      else expect(ctaFor(p.id, "acme", "prod_x")).not.toBeNull();
    }
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
