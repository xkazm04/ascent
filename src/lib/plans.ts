// Plan tiers — the single source of truth for what each plan includes, read by the credit/entitlement
// layer (gating) and the /pricing page (display). Before this, `plan` carried four values but only
// `enterprise` was ever special-cased (unlimited); `pro`/`team` were inert marketing.
//
// PRICE CONTRACT (checkout-plans-polar 07-16 #3): what a buyer is CHARGED is whatever the Polar
// product mapped via POLAR_PLAN_PRODUCTS costs — Polar is the price book. The `monthlyPrice` values
// below are DISPLAY-ONLY duplicates of those Polar prices for the static /pricing page and SEO copy;
// a price change in the Polar dashboard MUST be mirrored here in lockstep or /pricing advertises a
// stale number and buyers are charged something else at checkout. (The old header claimed "no dollar
// amounts are invented here", which hid this hazard.) An automated reconciliation now exists:
// src/lib/price-drift.ts fetches the live Polar prices and reports any mismatch on the operator KPI
// route (GET /api/kpi → `priceDrift`) — a detector, not a fixer; the mirror edit here is still manual.

// TIER ID vs TIER LABEL. `enterprise` is the STORED id — it is written to `Organization.plan`, appears
// in the POLAR_PLAN_PRODUCTS env mapping, and is compared by the webhook's downgrade-guard rank. The
// customer-facing NAME of that tier is `label` ("Custom"), which is display-only and safe to change.
// Renaming the id would be a data migration across every persisted org row plus a coordinated env edit
// on every deployment, for zero user-visible gain — so the tier reads "Custom" everywhere a human looks
// and stays `enterprise` everywhere a machine looks.

export type PlanId = "free" | "pro" | "team" | "enterprise";

/** How a plan is billed: free (no charge), a fixed monthly subscription, or a bespoke contract. */
export type PlanBilling = "free" | "subscription" | "custom";

export interface PlanFeature {
  id: PlanId;
  label: string;
  /** Monthly scan allowance — free METERED (org/private, installation-token) scans per month before
   *  overflow draws on prepaid credits. Anonymous PUBLIC scans are never metered (src/lib/db/credits.ts,
   *  the CreditMatrixLedger on /pricing) — they are quota-limited separately and never touch this.
   *  null = unlimited (Enterprise). This is the "included" volume; see scanAllowance(). */
  includedCredits: number | null;
  /** True when scans never consume a credit (the `enterprise` behaviour, data-driven). */
  unlimited: boolean;
  /** Fixed monthly subscription price in whole USD; 0 for Free, null for the custom (Enterprise) tier.
   *  Pro/Team are SUBSCRIPTIONS that bundle a monthly scan allowance; overflow buys extra scan credits.
   *  DISPLAY-ONLY: the real charge is the Polar product's price (POLAR_PLAN_PRODUCTS) — keep this in
   *  lockstep with the Polar dashboard (see the PRICE CONTRACT note atop this file). */
  monthlyPrice: number | null;
  billing: PlanBilling;
  /** Member seats included; null = unlimited. */
  seats: number | null;
  /** Scan-history retention in days; null = unlimited/inherit the deployment default. */
  retentionDays: number | null;
  blurb: string;
  /** Bullets BESIDE the headline scan volume — never restating it. The monthly scan number is rendered
   *  once per card, in its own typography, from `planScanLine()`; repeating it here as a bullet was the
   *  same sentence twice in one card. Keep this list to what the volume line does NOT already say. */
  features: string[];
}

export const PLAN_FEATURES: Record<PlanId, PlanFeature> = {
  free: {
    id: "free",
    label: "Free",
    includedCredits: 5,
    unlimited: false,
    monthlyPrice: 0,
    billing: "free",
    seats: 1,
    retentionDays: 30,
    blurb: "Private scans every month — public scans are always free — with the full report and badge.",
    features: ["Unlimited free public scans", "Maturity report + roadmap", "README badge", "1 member"],
  },
  pro: {
    id: "pro",
    label: "Pro",
    includedCredits: 100,
    unlimited: false,
    monthlyPrice: 10,
    billing: "subscription",
    seats: 3,
    retentionDays: 180,
    blurb: "A monthly subscription with the org fleet dashboard for a small team.",
    features: ["Org fleet dashboard", "Scheduled autoscans + alerts", "Buy extra scans anytime", "3 members", "180-day history"],
  },
  team: {
    id: "team",
    label: "Team",
    includedCredits: 500,
    unlimited: false,
    monthlyPrice: 20,
    billing: "subscription",
    seats: 10,
    retentionDays: 365,
    blurb: "More volume, more seats, and segment-scoped intelligence.",
    features: ["Segments + comparisons", "White-label briefings", "Playbooks + planning", "Buy extra scans anytime", "10 members", "1-year history"],
  },
  // Stored id `enterprise` (see the TIER ID vs TIER LABEL note atop this file); shown as "Custom".
  // Its bullets describe the DIMENSIONS that get scoped in the conversation, not a list of unlimited
  // things already switched on — the previous "Unlimited scans / Unlimited members / Priority support"
  // read as shipped entitlements when seats were never enforced and support has no defined tier.
  enterprise: {
    id: "enterprise",
    label: "Custom",
    includedCredits: null,
    unlimited: true,
    monthlyPrice: null,
    billing: "custom",
    seats: null,
    retentionDays: null,
    blurb: "Every line adjustable — hosting, scans, support, customization and sign-on.",
    features: [
      "Hosting — shared cloud, your VPC, or on-prem",
      "Scans — volume set to your fleet, not a tier",
      "Support — response times and an SLA you pick",
      "App customization — branding, dimensions, workflows",
      "SSO — SAML/OIDC sign-in and directory sync",
    ],
  },
};

/** Display / upgrade order, cheapest → richest. */
export const PLAN_ORDER: PlanId[] = ["free", "pro", "team", "enterprise"];

/** Customer-facing name of the tier whose private scans are never metered — what the "Credits ·
 *  Unlimited" chips name when they explain themselves. Derived from the model (not re-typed per chip)
 *  so a tier RENAME reaches every surface at once; see the TIER ID vs TIER LABEL note atop this file. */
export const UNLIMITED_PLAN_LABEL: string =
  PLAN_FEATURES[PLAN_ORDER.find((p) => PLAN_FEATURES[p].unlimited) ?? "enterprise"].label;

/** Display price for a plan card: the headline amount + a cadence sub-label. Derived from the model's
 *  `monthlyPrice`/`billing` so the /pricing figures can't drift from the data the gate reads. */
export function planPriceLabel(plan: PlanId): { amount: string; cadence: string } {
  const p = PLAN_FEATURES[plan];
  // The bespoke tier's headline is "Flexible", not "Custom" — the tier is already NAMED Custom, so
  // repeating the word as its price said nothing. "Flexible" is the price's actual property.
  if (p.billing === "custom" || p.monthlyPrice == null) return { amount: "Flexible", cadence: "scoped with you" };
  if (p.monthlyPrice === 0) return { amount: "$0", cadence: "free forever" };
  return { amount: `$${p.monthlyPrice}`, cadence: "/ month" };
}

/**
 * The headline scan-volume line on a plan card — the ONE place the monthly number is stated, in its own
 * typography above the feature bullets (which no longer restate it, see PlanFeature.features). Derived
 * from the same model the gate reads, so the figure can't drift from the allowance actually enforced.
 * The bespoke tier is described by how its volume is DECIDED rather than by "unlimited": it is unmetered
 * (`unlimited: true`) but sold as a negotiated volume, and "unlimited" oversold that.
 */
export function planScanLine(plan: PlanId): string {
  const p = PLAN_FEATURES[plan];
  if (p.billing === "custom") return "Scan volume you define";
  // Kept SHORT on purpose: this renders as mono type inside a narrow price column, and the longer
  // "… / mo included" wrapped to two lines in every cell, which pushed each card's hairline rule to a
  // different height and broke the row's alignment. "Included" is carried by the label above it.
  return p.includedCredits == null ? "Unlimited scans" : `${p.includedCredits} private scans / mo`;
}

export function isPlanId(v: string): v is PlanId {
  return v === "free" || v === "pro" || v === "team" || v === "enterprise";
}

/** Resolve a stored plan string to its feature set, defaulting unknown/blank to free. */
export function planFeatures(plan: string | null | undefined): PlanFeature {
  return (plan && isPlanId(plan) ? PLAN_FEATURES[plan] : null) ?? PLAN_FEATURES.free;
}

/** Plans whose private scans are included (never consume credits) — now data-driven. */
export function isUnlimitedPlan(plan: string | null | undefined): boolean {
  return planFeatures(plan).unlimited;
}

/** The plan's monthly metered-scan allowance (free scans before overflow draws on credits), or null
 *  for unlimited (Enterprise). A metered scan is free while the org is under this; beyond it, 1 credit. */
export function scanAllowance(plan: string | null | undefined): number | null {
  const p = planFeatures(plan);
  return p.unlimited ? null : (p.includedCredits ?? 0);
}

/** How a metered scan is billed under the hybrid model. */
export type ScanCharge = "unlimited" | "allowance" | "credit" | "denied";

/**
 * Decide how the NEXT metered scan is billed: free on the unlimited plan, free while under the monthly
 * allowance, then 1 prepaid credit, else denied (allowance spent + no credits → the 402/upgrade moment).
 * Pure — the caller supplies the org's plan-derived allowance, its month-to-date metered usage, and its
 * credit balance.
 */
export function decideScanCharge(opts: {
  unlimited: boolean;
  allowance: number | null;
  usageThisMonth: number;
  balance: number;
}): ScanCharge {
  if (opts.unlimited) return "unlimited";
  if (opts.allowance != null && opts.usageThisMonth < opts.allowance) return "allowance";
  return opts.balance > 0 ? "credit" : "denied";
}

/**
 * Resolve a metered scan's charge from an org's raw plan/usage/balance — the single source for the
 * `plan → {unlimited, allowance}` wiring around the pure `decideScanCharge` math. Used by BOTH the
 * read gate (`checkScanEntitlement`) and the write gate (`consumeScanCredit`) so the input assembly
 * can't drift between the two billing-sensitive paths. Pure — caller supplies the org's stored plan
 * string, its month-to-date metered usage, and its credit balance.
 */
export function resolveScanCharge(opts: { plan: string | null | undefined; usageThisMonth: number; balance: number }): ScanCharge {
  return decideScanCharge({
    unlimited: isUnlimitedPlan(opts.plan),
    allowance: scanAllowance(opts.plan),
    usageThisMonth: opts.usageThisMonth,
    balance: opts.balance,
  });
}

/** Plans that include white-label briefing branding — Team and up (was Enterprise-only; opened up so a
 *  Team-tier reseller can brand the reports they hand to clients). */
export function planAllowsWhiteLabel(plan: string | null | undefined): boolean {
  const id = plan && isPlanId(plan) ? plan : "free";
  return id === "team" || id === "enterprise";
}

/** Plans that may author + manage the Org Skills Library (Feature 2) — Team and up, for parity with
 *  Playbooks/Segments (§8.6). Reads stay open to all members; only create/edit/archive is gated. */
export function planAllowsSkillsLibrary(plan: string | null | undefined): boolean {
  const id = plan && isPlanId(plan) ? plan : "free";
  return id === "team" || id === "enterprise";
}

/** Plans that may WRITE to the Shared Org Memory (Memory-as-a-Service MVP) — Team and up, for parity
 *  with the Skills Library: the durable org knowledge store is a team asset, so authoring is the gated
 *  capability while reads stay open to every member (a memory nobody can read is worthless). */
export function planAllowsMemory(plan: string | null | undefined): boolean {
  const id = plan && isPlanId(plan) ? plan : "free";
  return id === "team" || id === "enterprise";
}

/** Plans that may connect their own LLM (BYOM / Bedrock — Feature 1) — Enterprise-only (§8.4): it's the
 *  marquee enterprise unlock (inference in the org's own AWS account/bill). A downgrade dormants any
 *  saved config (the provider resolver + settings route both gate on this). */
export function planAllowsByom(plan: string | null | undefined): boolean {
  const id = plan && isPlanId(plan) ? plan : "free";
  return id === "enterprise";
}

/** Plans that may export a saved report as a PDF — Pro and up. The PRD's legacy "Private" tier (paid,
 *  usage-based private-repo scanning) is what originally bundled PDF export; today's nearest equivalent
 *  is the lowest PAID plan (Pro), since Free is a real usage tier now (5 private scans/month) and
 *  gating any lower would mean no plan at all could ever unlock it. Least-breaking reading of an
 *  otherwise-stale "Private tier" label (g1-02). */
export function planAllowsPdfExport(plan: string | null | undefined): boolean {
  const id = plan && isPlanId(plan) ? plan : "free";
  return id === "pro" || id === "team" || id === "enterprise";
}

/**
 * The earliest scan date a plan's retention window includes, given the current time (ms since epoch).
 * `null` = unlimited retention (Enterprise / custom) — no lower bound. This is a NON-DESTRUCTIVE read
 * floor: callers clamp history/trend/trajectory READ queries to it so a tier's advertised retention
 * (Free 30d · Pro 180d · Team 365d) is real, without ever deleting data. `nowMs` is injected so the
 * function stays pure and unit-testable.
 */
export function retentionCutoff(plan: string | null | undefined, nowMs: number): Date | null {
  const days = planFeatures(plan).retentionDays;
  return days == null ? null : new Date(nowMs - days * 86_400_000);
}
