// Plan tiers — the single source of truth for what each plan includes, read by the credit/entitlement
// layer (gating) and the /pricing page (display). Before this, `plan` carried four values but only
// `enterprise` was ever special-cased (unlimited); `pro`/`team` were inert marketing.
//
// PRICE CONTRACT (checkout-plans-polar 07-16 #3): what a buyer is CHARGED is whatever the Polar
// product mapped via POLAR_PLAN_PRODUCTS costs — Polar is the price book. The `monthlyPrice` values
// below are DISPLAY-ONLY duplicates of those Polar prices for the static /pricing page and SEO copy;
// a price change in the Polar dashboard MUST be mirrored here in lockstep or /pricing advertises a
// stale number and buyers are charged something else at checkout. (The old header claimed "no dollar
// amounts are invented here", which hid this hazard.) Two reconciliations enforce the mirror:
//   1. RECORDED_PRICE_BOOK in src/lib/price-drift.ts — a dated transcript of the Polar price book in
//      Polar's own units (cents), asserted against `monthlyPrice` by a unit test. Editing a display
//      price alone now FAILS THE BUILD, so the price book has to be looked at, not assumed.
//   2. checkPriceDrift() — the live pull against Polar, reported on the operator KPI route
//      (GET /api/kpi → `priceDrift`). A detector, not a fixer; the mirror edit here is still manual.
//
// SELF-HOSTED DEPLOYMENTS. Ascent is AGPL software whose cloud sells OPERATION, not features. Gated
// capabilities therefore all resolve through the ONE `planAllows()` gate below, which short-circuits
// to "allowed" when `selfHosted()` is true; scans are unmetered and retention is unbounded — see
// src/lib/env.ts for how that mode is detected. The tier model still exists on a self-hosted box (it
// is the same code the cloud runs); it is simply not enforced. This used to be a rule to remember —
// five hand-written predicates each repeating the short-circuit, where a sixth that forgot it would
// silently make the open-source build worse than the cloud one. A new capability is now a row in
// PLAN_CAPABILITIES, not a new function, so there is no longer a place to forget it.

// TIER ID vs TIER LABEL. `enterprise` is the STORED id — it is written to `Organization.plan`, appears
// in the POLAR_PLAN_PRODUCTS env mapping, and is compared by the webhook's downgrade-guard rank. The
// customer-facing NAME of that tier is `label` ("Custom"), which is display-only and safe to change.
// Renaming the id would be a data migration across every persisted org row plus a coordinated env edit
// on every deployment, for zero user-visible gain — so the tier reads "Custom" everywhere a human looks
// and stays `enterprise` everywhere a machine looks.

import { selfHosted } from "@/lib/env";

export type PlanId = "free" | "pro" | "team" | "enterprise";

/** Display / upgrade order, cheapest → richest. Also the rank the webhook's downgrade guard compares
 *  on, and the ladder capability inclusion is computed against (see PLAN_CAPABILITIES). */
export const PLAN_ORDER: PlanId[] = ["free", "pro", "team", "enterprise"];

/** How a plan is billed: free (no charge), a fixed monthly subscription, or a bespoke contract. */
export type PlanBilling = "free" | "subscription" | "custom";

/** A capability that a tier either includes or doesn't, and that some call site actually REFUSES when
 *  it doesn't. Only gated things belong here: the pricing page also lists capabilities no code checks
 *  (the fleet dashboard, autoscans, segments, playbooks — see the "advertises but nothing enforces"
 *  table in docs/features/billing/billing.md), and those stay hand-written `extras` precisely so this
 *  union means "enforced" rather than "mentioned". */
export type PlanCapability = "whiteLabel" | "skillsLibrary" | "memory" | "byom" | "pdfExport";

export interface PlanCapabilityMeta {
  id: PlanCapability;
  /** Cheapest tier that includes it. Capabilities are CUMULATIVE up PLAN_ORDER: every richer tier
   *  includes it too, which is what the ladder on /pricing already promises. */
  minPlan: PlanId;
  /** Customer-facing name — the plan card's bullet AND the credit-matrix row label, one string so the
   *  card and the matrix on the same page cannot name the same capability two different ways. */
  label: string;
  /** One-line explanation, for the credit-matrix row. */
  detail: string;
}

/**
 * The capability model: what a tier INCLUDES, in one table that both the gate and the page read.
 *
 * Before this, each capability was a hand-written predicate re-opening the tier vocabulary inline
 * (`id === "team" || id === "enterprise"`, five times) while /pricing sold the same capabilities as
 * typed prose no gate read. Two sources that agreed only by hand: a capability could move tiers in
 * code and the card would keep advertising the old tier, so a buyer paid for a tier and hit a wall
 * the card promised was included — and adding a tier meant editing five predicates, where missing one
 * is a silent entitlement bug. The trade-off accepted: capabilities must be expressible as "this tier
 * and up". Anything genuinely non-monotonic (a capability at Team but not Custom) would need its own
 * shape; nothing in the catalogue is, and the pricing ladder would be lying if one were.
 *
 * Order here is the order bullets and matrix rows render in.
 */
export const PLAN_CAPABILITIES: Record<PlanCapability, PlanCapabilityMeta> = {
  // Was Custom-only; opened to Team so a Team-tier reseller can brand the reports they hand to clients.
  whiteLabel: {
    id: "whiteLabel",
    minPlan: "team",
    label: "White-label briefings",
    detail: "Board-ready briefings under your own brand.",
  },
  // Authoring the Org Skills Library (Feature 2). Reads stay open to every member; only
  // create/edit/archive is gated (§8.6, parity with Playbooks/Segments).
  skillsLibrary: {
    id: "skillsLibrary",
    minPlan: "team",
    label: "Skills library",
    detail: "Author and roll out your own agent-skill catalog.",
  },
  // WRITING to the Shared Org Memory (Memory-as-a-Service MVP). Reads stay open for the same reason
  // as the Skills Library: a memory nobody can read is worthless.
  memory: {
    id: "memory",
    minPlan: "team",
    label: "Shared org memory",
    detail: "Author the durable org knowledge store every member reads.",
  },
  // Team and up since 2026-08-19; Custom-only before that (§8.4). It was the marquee enterprise unlock
  // when there was no alternative to the hosted product. Under open-source-first there is one: a
  // self-hoster points Ascent at any model, including a local one, for free. BYOM is therefore the
  // exact concession that keeps a customer who COULD self-host on the cloud — "keep your model and
  // your inference bill, let us run everything else" — and pricing it out of reach of everyone below
  // Custom pushed that customer toward `git clone` instead. What stays genuinely Custom-tier is
  // operational, not capability: SSO, VPC/on-prem hosting, an SLA. A downgrade dormants any saved
  // config (the provider resolver + settings route both gate on this).
  byom: {
    id: "byom",
    minPlan: "team",
    label: "Connect your own model (BYOM)",
    detail: "Run scoring on your own Bedrock or OpenRouter account.",
  },
  // The PRD's legacy "Private" tier (paid, usage-based private-repo scanning) is what originally
  // bundled PDF export; today's nearest equivalent is the lowest PAID plan, since Free is a real usage
  // tier now and gating any lower would mean no plan could ever unlock it (g1-02).
  pdfExport: {
    id: "pdfExport",
    minPlan: "pro",
    label: "PDF export",
    detail: "Download any saved report as a PDF.",
  },
};

/** Render/iteration order for capabilities — the declaration order of the table above. */
export const PLAN_CAPABILITY_ORDER: PlanCapability[] = Object.keys(PLAN_CAPABILITIES) as PlanCapability[];

/** Capabilities a tier includes: everything whose `minPlan` is at or below it on PLAN_ORDER. */
function capabilitiesOf(plan: PlanId): PlanCapability[] {
  const rank = PLAN_ORDER.indexOf(plan);
  return PLAN_CAPABILITY_ORDER.filter((c) => rank >= PLAN_ORDER.indexOf(PLAN_CAPABILITIES[c].minPlan));
}

/** Capabilities a tier is the FIRST to include — what its plan card advertises as new at this step of
 *  the ladder. The cards have always listed what a tier adds rather than restating the tier below. */
export function newCapabilitiesAt(plan: PlanId): PlanCapability[] {
  return PLAN_CAPABILITY_ORDER.filter((c) => PLAN_CAPABILITIES[c].minPlan === plan);
}

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
   *  Starter/Team are SUBSCRIPTIONS that bundle a monthly scan allowance; overflow buys extra scan credits.
   *  DISPLAY-ONLY: the real charge is the Polar product's price (POLAR_PLAN_PRODUCTS) — keep this in
   *  lockstep with the Polar dashboard (see the PRICE CONTRACT note atop this file). */
  monthlyPrice: number | null;
  billing: PlanBilling;
  /** Member seats included; null = unlimited. */
  seats: number | null;
  /** Scan-history retention in days; null = unlimited/inherit the deployment default. */
  retentionDays: number | null;
  blurb: string;
  /** Gated capabilities this tier includes — DERIVED from PLAN_CAPABILITIES, never hand-listed. This
   *  is the array `planAllows()` indexes, and the array the credit matrix ticks its cells from. */
  capabilities: readonly PlanCapability[];
  /** Bullets BESIDE the headline scan volume — never restating it. The monthly scan number is rendered
   *  once per card, in its own typography, from `planScanLine()`; repeating it here as a bullet was the
   *  same sentence twice in one card. Keep this list to what the volume line does NOT already say.
   *  DERIVED: the gated capabilities this tier is first to include, then the tier's `extras`. */
  features: string[];
}

/** How a tier is WRITTEN below: everything except the two derived fields, plus the ungated prose
 *  bullets. `extras` is the hand-typed half of a card — real selling points with no code gate behind
 *  them (fleet dashboard, autoscans, seat counts, history windows). Keeping them separate from
 *  capabilities is the point: a bullet in `extras` is a promise, a bullet from PLAN_CAPABILITIES is
 *  enforced, and the split makes which is which visible instead of a matter of memory. */
interface PlanSpec extends Omit<PlanFeature, "features" | "capabilities"> {
  extras: string[];
}

const PLAN_SPECS: Record<PlanId, PlanSpec> = {
  free: {
    id: "free",
    label: "Free",
    // Raised from 5 on 2026-08-19, with the open-source transition. The Free tier's JOB changed: it
    // used to be a trial of a product with no alternative, and it is now competing with `git clone`
    // — a self-hosted Ascent that is unlimited, ungated and free forever. Five private scans a month
    // is not a reason to stay on the cloud; it is a reason to go read the Dockerfile. This is the one
    // number to tune if hosted COGS runs ahead of conversion (it is the whole cloud free-tier bill).
    includedCredits: 20,
    unlimited: false,
    monthlyPrice: 0,
    billing: "free",
    seats: 1,
    retentionDays: 30,
    blurb: "Private scans every month, and public scans are always free, with the full report and badge.",
    extras: ["Unlimited free public scans", "Maturity report + roadmap", "README badge", "1 member"],
  },
  // Stored id `pro`, shown as "Starter" — the same display-only rename as `enterprise`/"Custom" (see
  // the TIER ID vs TIER LABEL note atop this file). The id is on Organization.plan and in the
  // POLAR_PLAN_PRODUCTS mapping, so it cannot move; only the name a buyer reads does.
  pro: {
    id: "pro",
    label: "Starter",
    includedCredits: 50,
    unlimited: false,
    monthlyPrice: 5,
    billing: "subscription",
    seats: 3,
    retentionDays: 180,
    blurb: "A monthly subscription with the org fleet dashboard for a small team.",
    extras: ["Org fleet dashboard", "Scheduled autoscans + alerts", "Buy extra scans anytime", "3 members", "180-day history"],
  },
  team: {
    id: "team",
    label: "Team",
    includedCredits: 150,
    unlimited: false,
    monthlyPrice: 10,
    billing: "subscription",
    seats: 10,
    retentionDays: 365,
    blurb: "More volume, more seats, and segment-scoped intelligence.",
    extras: ["Segments + comparisons", "Playbooks + planning", "Buy extra scans anytime", "10 members", "1-year history"],
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
    blurb: "Every line adjustable: hosting, scans, support, customization and sign-on.",
    extras: [
      "Hosting: shared cloud, your VPC, or on-prem",
      "Scans: volume set to your fleet, not a tier",
      "Support: response times and an SLA you pick",
      "App customization: branding, dimensions, workflows",
      "SSO: SAML/OIDC sign-in and directory sync",
    ],
  },
};

/**
 * The plan model every surface reads: the written spec above, plus the two DERIVED fields.
 *
 * `capabilities` is what the gate indexes; `features` is what a plan card prints — the capabilities
 * this tier is the first to include, named by the capability table, followed by the tier's ungated
 * `extras`. The card can therefore no longer advertise a capability the gate refuses, or stay silent
 * about one the gate allows (PDF export was gated at Starter and sold on no card at all; the Skills
 * Library and Shared Org Memory were gated at Team and missing from the Team card).
 */
export const PLAN_FEATURES: Record<PlanId, PlanFeature> = (() => {
  const built = {} as Record<PlanId, PlanFeature>;
  for (const id of PLAN_ORDER) {
    const { extras, ...spec } = PLAN_SPECS[id];
    built[id] = {
      ...spec,
      capabilities: capabilitiesOf(id),
      features: [...newCapabilitiesAt(id).map((c) => PLAN_CAPABILITIES[c].label), ...extras],
    };
  }
  return built;
})();

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

/** Plans whose private scans are included (never consume credits) — now data-driven. A SELF-HOSTED
 *  deployment is always unlimited: the operator is paying their own LLM and infrastructure bill, so
 *  there is nothing for a credit to meter. */
export function isUnlimitedPlan(plan: string | null | undefined): boolean {
  return selfHosted() || planFeatures(plan).unlimited;
}

/** The plan's monthly metered-scan allowance (free scans before overflow draws on credits), or null
 *  for unlimited (Enterprise). A metered scan is free while the org is under this; beyond it, 1 credit. */
export function scanAllowance(plan: string | null | undefined): number | null {
  if (selfHosted()) return null; // unmetered — see the SELF-HOSTED note atop this file
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

/**
 * THE capability gate. Every gated capability resolves here, so there is exactly one place the
 * self-hosted short-circuit lives and exactly one place the tier vocabulary is read.
 *
 * TWO UNKNOWNS, OPPOSITE SAFE DEFAULTS — do not collapse them:
 *  - an unrecognised TIER value (a typo, a tier removed from the model, a hand-edited DB row) floors
 *    to `free` via planFeatures(). Under-granting is the safe direction: the customer sees an upsell
 *    and complains, which is recoverable; over-granting hands out paid capability silently.
 *  - an unknown TENANT is a different question with the opposite answer — a slug that matched no org
 *    row must be REFUSED, not floored, because flooring would grant it the free tier's entitlements.
 *    That refusal lives with the tenant lookup, in src/lib/entitlement.ts (`orgExists`), because that
 *    is where the org's existence is actually known; this function is only ever handed a plan string.
 */
export function planAllows(capability: PlanCapability, plan: string | null | undefined): boolean {
  // Self-hosted sells operation, not capability — see the SELF-HOSTED note atop this file. This is
  // the only copy of that short-circuit, which is why a new capability cannot forget it.
  if (selfHosted()) return true;
  return planFeatures(plan).capabilities.includes(capability);
}

// The five named gates below are thin, stable aliases of `planAllows` — they keep ~15 call sites and
// their tests reading in domain terms rather than passing a capability id around, while the tier
// decision itself lives only in PLAN_CAPABILITIES. Each is now a lookup, not a predicate.

/** Plans that include white-label briefing branding. */
export function planAllowsWhiteLabel(plan: string | null | undefined): boolean {
  return planAllows("whiteLabel", plan);
}

/** Plans that may author + manage the Org Skills Library (Feature 2); reads stay open to all members. */
export function planAllowsSkillsLibrary(plan: string | null | undefined): boolean {
  return planAllows("skillsLibrary", plan);
}

/** Plans that may WRITE to the Shared Org Memory (Memory-as-a-Service MVP); reads stay open. */
export function planAllowsMemory(plan: string | null | undefined): boolean {
  return planAllows("memory", plan);
}

/** Plans that may connect their own LLM (BYOM — Bedrock or OpenRouter). */
export function planAllowsByom(plan: string | null | undefined): boolean {
  return planAllows("byom", plan);
}

/** Plans that may export a saved report as a PDF. */
export function planAllowsPdfExport(plan: string | null | undefined): boolean {
  return planAllows("pdfExport", plan);
}

/**
 * The earliest scan date a plan's retention window includes, given the current time (ms since epoch).
 * `null` = unlimited retention (Enterprise / custom) — no lower bound. This is a NON-DESTRUCTIVE read
 * floor: callers clamp history/trend/trajectory READ queries to it so a tier's advertised retention
 * (Free 30d · Pro 180d · Team 365d) is real, without ever deleting data. `nowMs` is injected so the
 * function stays pure and unit-testable.
 */
export function retentionCutoff(plan: string | null | undefined, nowMs: number): Date | null {
  // Self-hosted: it is the operator's own disk and their own retention policy. Ascent Cloud's tiered
  // read floor is a COGS control, and applying it to someone else's Postgres would hide their data
  // from them for no reason.
  if (selfHosted()) return null;
  const days = planFeatures(plan).retentionDays;
  return days == null ? null : new Date(nowMs - days * 86_400_000);
}
