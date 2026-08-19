// Single source of truth for the "Credits & capabilities" matrix — what draws on scan credits vs.
// what each package includes. Kept as pure data (server-safe) so every variant renders the SAME honest
// breakdown, mirroring how the dimension matrix reads shared `matrixData`. Sourced from the credit /
// plan model: credits are consumed by exactly ONE kind of operation — a metered PRIVATE scan, and only
// beyond the monthly allowance (see src/lib/entitlement.ts, src/lib/db/credits.ts, src/lib/plans.ts).
// Public scans, cached re-scans, and every capability below are never metered.

import { PLAN_FEATURES, PLAN_ORDER, type PlanId } from "@/lib/plans";

export type { PlanId };

export interface MatrixPlan {
  id: PlanId;
  label: string;
  /** Monthly included scan allowance (display) — free scans before overflow draws on credits. */
  allowance: string;
  /** The emphasized column, tinted like the /pricing card's accent ring. */
  featured?: boolean;
}

// DERIVED from PLAN_FEATURES, not re-typed. This file used to carry its own copy of the tier list, the
// labels and the allowances — so a repricing had to be made in two places, and the matrix silently
// contradicting the price cards it sits directly beneath was one forgotten edit away. (It also declared
// its own `PlanId` union, which would have drifted from the real one on any tier change.) The stored
// ids stay the keys; only the NAMES a buyer reads come from `label` — `pro` shows as "Starter",
// `enterprise` as "Custom" (see the TIER ID vs TIER LABEL note in src/lib/plans.ts).
export const MATRIX_PLANS: MatrixPlan[] = PLAN_ORDER.map((id) => {
  const p = PLAN_FEATURES[id];
  return {
    id,
    label: p.label,
    // The bespoke tier has no number to print — its volume is the thing being negotiated.
    allowance: p.includedCredits == null ? "Yours" : String(p.includedCredits),
    ...(id === "team" ? { featured: true } : {}),
  };
});

/**
 * How an operation relates to credits — the three-way distinction the whole matrix exists to make
 * legible:
 *  - `credit` — draws on your monthly scan allowance, then 1 credit each. The ONLY thing credits buy.
 *  - `free`   — never costs a credit on any plan (public scans + cached re-scans).
 *  - `plan`   — a capability included with the package; never metered by credits.
 */
export type CreditTag = "credit" | "free" | "plan";

export const CREDIT_TAG_META: Record<CreditTag, { label: string; short: string; glyph: string }> = {
  credit: { label: "Draws on credits", short: "Credits", glyph: "◈" },
  free: { label: "Always free", short: "Free", glyph: "○" },
  plan: { label: "Included in plan", short: "Included", glyph: "▸" },
};

/** A per-plan cell: a boolean availability (✓ / —) or a concrete value ("500 / mo", "1 year"). */
export type Cell = boolean | string;

export interface MatrixRow {
  label: string;
  detail: string;
  tag: CreditTag;
  cells: Record<PlanId, Cell>;
}

export interface MatrixGroup {
  key: string;
  title: string;
  intro: string;
  rows: MatrixRow[];
}

const ORDER: PlanId[] = PLAN_ORDER;

/** Per-tier "N / mo" cells for the scan row, read from the plan model so they can't drift from the
 *  allowance the entitlement gate actually enforces. */
const allowanceCells = (): Record<PlanId, Cell> =>
  Object.fromEntries(
    PLAN_ORDER.map((id) => {
      const n = PLAN_FEATURES[id].includedCredits;
      return [id, n == null ? "Your volume" : `${n} / mo`];
    }),
  ) as Record<PlanId, Cell>;

/** Same value in every column (a universally-available or universally-free row). */
const all = (v: Cell): Record<PlanId, Cell> => ({ free: v, pro: v, team: v, enterprise: v });

/** Available from `tier` onward (features are cumulative up the ladder). */
const from = (tier: PlanId): Record<PlanId, Cell> => {
  const i = ORDER.indexOf(tier);
  return Object.fromEntries(ORDER.map((p, j) => [p, j >= i])) as Record<PlanId, Cell>;
};

export const MATRIX_GROUPS: MatrixGroup[] = [
  {
    key: "scanning",
    title: "Scanning",
    intro: "Every scan, public or private, draws on one monthly allowance; only scans past it cost a credit.",
    rows: [
      {
        label: "Repository scan",
        detail: "Any public or private repo: the full report, radar and roadmap. Free within your monthly allowance, then 1 credit each.",
        tag: "credit",
        // Same derivation as MATRIX_PLANS — the one row in this table that restates a plan number.
        cells: allowanceCells(),
      },
      {
        label: "Re-scan an unchanged commit",
        detail: "Cached: re-running a scan on the same commit never costs a credit.",
        tag: "free",
        cells: all(true),
      },
      {
        label: "Scheduled autoscans",
        detail: "Watched repos rescanned on a schedule, each counts as one scan.",
        tag: "credit",
        cells: from("pro"),
      },
      {
        label: "Buy extra scan credits",
        detail: "Top up prepaid credits for scans beyond your plan; they roll over and never expire.",
        tag: "plan",
        cells: from("pro"),
      },
    ],
  },
  {
    key: "capabilities",
    title: "Capabilities",
    intro: "Everything the report and the fleet dashboard unlock, included with your package, never metered.",
    rows: [
      { label: "Maturity report + roadmap", detail: "The full level, radar and prioritized next steps.", tag: "plan", cells: all(true) },
      { label: "README maturity badge", detail: "A live, shareable score badge for your repo.", tag: "plan", cells: all(true) },
      { label: "Org fleet dashboard", detail: "Rollups, leaderboard and the dimension heatmap.", tag: "plan", cells: from("pro") },
      { label: "Regression + credit alerts", detail: "Slack-compatible pushes when a repo slips or credits run low.", tag: "plan", cells: from("pro") },
      { label: "Scan history", detail: "Progress trends over your retention window.", tag: "plan", cells: { free: "30 days", pro: "180 days", team: "1 year", enterprise: "Custom" } },
      { label: "Segments + comparisons", detail: "Slice the fleet by business unit and compare side by side.", tag: "plan", cells: from("team") },
      { label: "Playbooks + planning", detail: "Turn gaps into tracked initiatives and goals.", tag: "plan", cells: from("team") },
      { label: "White-label briefings", detail: "Board-ready PDF briefings under your own brand.", tag: "plan", cells: from("team") },
      { label: "Skills library", detail: "Author and roll out your own agent-skill catalog.", tag: "plan", cells: from("team") },
      // BYOM ships today and is genuinely gated at this tier (planAllowsByom) — Team and up since the
      // open-source transition: it is the concession that keeps a customer who COULD self-host on the
      // cloud, so pricing it at Enterprise pushed exactly that customer toward `git clone`.
      { label: "Connect your own model", detail: "Run scoring on your own Bedrock or OpenRouter account (bring-your-own-model).", tag: "plan", cells: from("team") },
      // Roles and the audit trail ship today; SAML/OIDC sign-in does NOT — the login is GitHub OAuth via
      // Supabase (src/lib/auth.ts). A ✓ here claimed a shipped capability. Under the Custom tier's
      // "adjustable, scoped with you" framing the honest cell is "Scoped", which is what the enquiry
      // form is for; the RBAC + audit half is stated separately below because it really is available.
      { label: "Roles · audit log", detail: "Owner/admin/member roles and a full audit trail.", tag: "plan", cells: from("pro") },
      { label: "SSO · SAML/OIDC", detail: "Directory sign-in and provisioning, scoped as part of a Custom plan.", tag: "plan", cells: { free: false, pro: false, team: false, enterprise: "Scoped" } },
      { label: "Hosting", detail: "Where Ascent and its inference run.", tag: "plan", cells: { free: "Shared cloud", pro: "Shared cloud", team: "Shared cloud", enterprise: "Your VPC / on-prem" } },
      { label: "Support", detail: "How fast you can expect an answer.", tag: "plan", cells: { free: "Community", pro: "Email", team: "Email", enterprise: "SLA you pick" } },
      { label: "Members / seats", detail: "How many teammates can share the org.", tag: "plan", cells: { free: "1", pro: "3", team: "10", enterprise: "Yours to set" } },
    ],
  },
];

/** The one-sentence rule the whole matrix proves — reused across variants so copy can't drift. */
export const CREDIT_RULE =
  "Credits buy exactly one thing: a scan beyond your monthly allowance. Cached re-scans and every capability are free or included in your plan.";
