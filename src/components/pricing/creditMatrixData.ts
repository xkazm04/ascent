// Single source of truth for the "Credits & capabilities" matrix — what draws on scan credits vs.
// what each package includes. Kept as pure data (server-safe) so every variant renders the SAME honest
// breakdown, mirroring how the dimension matrix reads shared `matrixData`. Sourced from the credit /
// plan model: credits are consumed by exactly ONE kind of operation — a metered PRIVATE scan, and only
// beyond the monthly allowance (see src/lib/entitlement.ts, src/lib/db/credits.ts, src/lib/plans.ts).
// Public scans, cached re-scans, and every capability below are never metered.

export type PlanId = "free" | "pro" | "team" | "enterprise";

export interface MatrixPlan {
  id: PlanId;
  label: string;
  /** Monthly included scan allowance (display) — free scans before overflow draws on credits. */
  allowance: string;
  /** The "most popular" column, tinted like the /pricing highlight. */
  featured?: boolean;
}

export const MATRIX_PLANS: MatrixPlan[] = [
  { id: "free", label: "Free", allowance: "10" },
  { id: "pro", label: "Pro", allowance: "100" },
  { id: "team", label: "Team", allowance: "500", featured: true },
  { id: "enterprise", label: "Enterprise", allowance: "∞" },
];

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

const ORDER: PlanId[] = ["free", "pro", "team", "enterprise"];

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
    intro: "The only operations credits pay for — and only a private scan past your monthly allowance.",
    rows: [
      {
        label: "Public repo scan",
        detail: "Any public repository, on the web — full report, radar and badge.",
        tag: "free",
        cells: all("Unlimited"),
      },
      {
        label: "Private repo scan",
        detail: "Free within your monthly allowance, then 1 credit each.",
        tag: "credit",
        cells: { free: "10 / mo", pro: "100 / mo", team: "500 / mo", enterprise: "Unlimited" },
      },
      {
        label: "Re-scan an unchanged commit",
        detail: "Cached — re-running a scan on the same commit never costs a credit.",
        tag: "free",
        cells: all(true),
      },
      {
        label: "Scheduled autoscans",
        detail: "Watched repos rescanned on a schedule — each counts as one scan.",
        tag: "credit",
        cells: from("pro"),
      },
    ],
  },
  {
    key: "capabilities",
    title: "Capabilities",
    intro: "Everything the report and the fleet dashboard unlock — included with your package, never metered.",
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
      { label: "Private inference · AWS Bedrock", detail: "Run scoring in your own AWS account (bring-your-own-model).", tag: "plan", cells: from("enterprise") },
      { label: "SSO · RBAC · audit logs", detail: "SAML sign-in, roles, and a full audit trail.", tag: "plan", cells: from("enterprise") },
      { label: "Members / seats", detail: "How many teammates can share the org.", tag: "plan", cells: { free: "1", pro: "3", team: "10", enterprise: "Unlimited" } },
    ],
  },
];

/** The one-sentence rule the whole matrix proves — reused across variants so copy can't drift. */
export const CREDIT_RULE =
  "Credits buy exactly one thing: a private scan beyond your monthly allowance. Public scans, cached re-scans, and every capability are free or included in your plan.";
