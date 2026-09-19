// The /pricing tier CTA decision, as a sibling module rather than a named export of the page.
//
// WHY IT MOVED. `page.tsx` is an App Router page; Next's generated route types allow a page module to
// export only the route contract (default component, `metadata`, `dynamic`, …). A stray `export function
// ctaFor` made `.next/types` fail the "does not satisfy" check, so `npx tsc --noEmit` was red on a clean
// tree and stayed that way — a permanently-failing gate that everyone learned to read past. The function
// was exported only because its test imports it, which is exactly the shape a sibling module is for.
//
// Each tier's primary CTA points at its REAL destination, labeled to match. The previous single
// `href={id === "free" ? "/" : "/connect"}` ternary sent the paid tiers AND the bespoke one to /connect
// (the repo-watch page): "Contact us" dead-ended with no way to reach anyone, and "Get started" landed
// on a screen that is neither a checkout nor a plan upgrade. Free → run a scan.
//
// Starter/Team (G1-01): when Polar is configured with a POLAR_PLAN_PRODUCTS mapping for the tier AND we
// can resolve the signed-in viewer's org (the checkout route requires ?org=, see /api/billing/checkout),
// the CTA becomes a REAL "Subscribe" checkout link. Anonymous visitors, viewers without an org yet, or a
// deployment with Polar unconfigured/no plan-product mapping all degrade to the previous "Get started" →
// /onboarding funnel (a real, working destination, never a dead button) — /onboarding is where an org
// gets created in the first place, and the org dashboard's own CreditsControl offers the same checkout
// once the org exists.
//
// The CUSTOM tier (billing: "custom") has no href at all: `ctaFor` returns null and the card renders
// PlanEnquiryCta, a dialog that captures the requirement and mails it to the operator. It used to be a
// `mailto:` when ASCENT_CONTACT_EMAIL was set and "Learn more" → /about when it wasn't — so on a deploy
// without that env, the page's highest-intent click landed on a marketing page.

import { PLAN_FEATURES, type PlanId } from "@/lib/plans";

/** Pure — testable without rendering the page. `org`/`planProductId` are already resolved by the
 *  caller (null/undefined when unavailable), so this only decides the CTA shape from that outcome.
 *  `null` means "this tier has no destination" — the card renders the enquiry dialog instead. */
export function ctaFor(
  id: PlanId,
  org: string | null,
  planProductId: string | undefined,
): { href: string; label: string } | null {
  if (id === "free") return { href: "/", label: "Scan a repo free" };
  // Keyed off the BILLING MODEL, not the literal id: a bespoke tier is one that can't be bought from a
  // page, whatever it ends up being called.
  if (PLAN_FEATURES[id].billing === "custom") return null;
  if (org && planProductId) {
    return {
      href: `/api/billing/checkout?org=${encodeURIComponent(org)}&pack=${encodeURIComponent(planProductId)}`,
      label: "Subscribe",
    };
  }
  return { href: "/onboarding", label: "Get started" };
}
