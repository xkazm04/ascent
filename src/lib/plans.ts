// Plan tiers — the single source of truth for what each plan includes, read by the credit/entitlement
// layer (gating) and the /pricing page (display). Before this, `plan` carried four values but only
// `enterprise` was ever special-cased (unlimited); `pro`/`team` were inert marketing. Pricing itself
// lives in the billing provider (Stripe, see CRED-1) — this map is feature/allotment metadata, not the
// price book, so no dollar amounts are invented here.

export type PlanId = "free" | "pro" | "team" | "enterprise";

export interface PlanFeature {
  id: PlanId;
  label: string;
  /** Monthly included private-scan credits; null = unlimited (no debit). */
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
    includedCredits: 0,
    unlimited: false,
    seats: 1,
    retentionDays: 30,
    blurb: "Public-repo scans, badge, and the full report — free forever.",
    features: ["Unlimited public-repo scans", "Maturity report + roadmap", "README badge", "1 member"],
  },
  pro: {
    id: "pro",
    label: "Pro",
    includedCredits: 100,
    unlimited: false,
    seats: 3,
    retentionDays: 180,
    blurb: "Private repos + the org fleet dashboard for a small team.",
    features: ["100 private scans / month", "Org fleet dashboard", "Scheduled autoscans + alerts", "3 members", "180-day history"],
  },
  team: {
    id: "team",
    label: "Team",
    includedCredits: 500,
    unlimited: false,
    seats: 10,
    retentionDays: 365,
    blurb: "More volume, more seats, and segment-scoped intelligence.",
    features: ["500 private scans / month", "Segments + comparisons", "Playbooks + planning", "10 members", "1-year history"],
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
