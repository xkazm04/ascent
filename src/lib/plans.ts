// Plan tiers — the single source of truth for what each plan includes, read by the credit/entitlement
// layer (gating) and the /pricing page (display). Before this, `plan` carried four values but only
// `enterprise` was ever special-cased (unlimited); `pro`/`team` were inert marketing. Pricing itself
// lives in the billing provider (Polar, see CRED-1) — this map is feature/allotment metadata, not the
// price book, so no dollar amounts are invented here.

export type PlanId = "free" | "pro" | "team" | "enterprise";

export interface PlanFeature {
  id: PlanId;
  label: string;
  /** Monthly metered-scan allowance — free scans/month before overflow draws on prepaid credits.
   *  null = unlimited (Enterprise). This is the "included" volume; see scanAllowance(). */
  includedCredits: number | null;
  /** True when private scans never consume a credit (the `enterprise` behaviour, now data-driven). */
  unlimited: boolean;
  /** Member seats included; null = unlimited. */
  seats: number | null;
  /** Scan-history retention in days; null = unlimited/inherit the deployment default. */
  retentionDays: number | null;
  blurb: string;
  features: string[];
}

export const PLAN_FEATURES: Record<PlanId, PlanFeature> = {
  free: {
    id: "free",
    label: "Free",
    includedCredits: 10,
    unlimited: false,
    seats: 1,
    retentionDays: 30,
    blurb: "Free public-repo scans, badge, and the full report — plus 10 org scans a month.",
    features: ["10 scans / month included", "Free public-repo scans (fair-use)", "Maturity report + roadmap", "README badge", "1 member"],
  },
  pro: {
    id: "pro",
    label: "Pro",
    includedCredits: 100,
    unlimited: false,
    seats: 3,
    retentionDays: 180,
    blurb: "Private repos + the org fleet dashboard for a small team.",
    features: ["100 scans / month included", "Org fleet dashboard", "Scheduled autoscans + alerts", "3 members", "180-day history"],
  },
  team: {
    id: "team",
    label: "Team",
    includedCredits: 500,
    unlimited: false,
    seats: 10,
    retentionDays: 365,
    blurb: "More volume, more seats, and segment-scoped intelligence.",
    features: ["500 scans / month included", "Segments + comparisons", "White-label briefings", "Playbooks + planning", "10 members", "1-year history"],
  },
  enterprise: {
    id: "enterprise",
    label: "Enterprise",
    includedCredits: null,
    unlimited: true,
    seats: null,
    retentionDays: null,
    blurb: "Unlimited scans, SSO-ready access, and custom retention.",
    features: ["Unlimited private scans", "Unlimited members", "Custom retention", "Priority support"],
  },
};

/** Display / upgrade order, cheapest → richest. */
export const PLAN_ORDER: PlanId[] = ["free", "pro", "team", "enterprise"];

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

/** Plans that may connect their own LLM (BYOM / Bedrock — Feature 1) — Enterprise-only (§8.4): it's the
 *  marquee enterprise unlock (inference in the org's own AWS account/bill). A downgrade dormants any
 *  saved config (the provider resolver + settings route both gate on this). */
export function planAllowsByom(plan: string | null | undefined): boolean {
  const id = plan && isPlanId(plan) ? plan : "free";
  return id === "enterprise";
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
