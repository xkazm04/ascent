// Single source of truth for the "Credits & capabilities" matrix — what draws on scan credits vs.
// what each package includes. Kept as pure data (server-safe) so every variant renders the SAME honest
// breakdown, mirroring how the dimension matrix reads shared `matrixData`. Sourced from the credit /
// plan model: credits are consumed by exactly ONE kind of operation — a metered PRIVATE scan, and only
// beyond the monthly allowance (see src/lib/entitlement.ts, src/lib/db/credits.ts, src/lib/plans.ts).
// Public scans, cached re-scans, and every capability below are never metered.

import { PLAN_CAPABILITIES, PLAN_CAPABILITY_ORDER, PLAN_FEATURES, PLAN_ORDER, type PlanId } from "@/lib/plans";

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
  /**
   * The row states a tier boundary that NOTHING IN THE CODE ENFORCES — a commercial intent, not a
   * gate. `docs/features/billing/billing.md:424-438` audited every `planAllows*` predicate and every
   * plan comparison in the tree and found these six: the fleet dashboard, autoscans + alerts,
   * segments, playbooks, buying credits, and seats. A Free org gets all of them today.
   *
   * Leaving them ticked-and-unmarked was the page asserting a restriction it does not apply, which is
   * the same defect as promising a capability that doesn't exist, only pointed the other way. The
   * rows stay (they are the roadmap a buyer is buying into) and say so in the open.
   *
   * A row derived from `PLAN_CAPABILITIES` must NEVER carry this flag — those cells ARE the gate,
   * ticked from the array `planAllows()` indexes. `creditMatrixData.test.ts` pins both directions.
   */
  planned?: true;
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

/** One matrix row per gated capability, in PLAN_CAPABILITY_ORDER. The cells read
 *  `PLAN_FEATURES[id].capabilities` rather than re-deriving a tier threshold, so a cell is a ✓ exactly
 *  when `planAllows()` would say yes for that tier — the page and the gate cannot disagree. */
const capabilityRows = (): MatrixRow[] =>
  PLAN_CAPABILITY_ORDER.map((c) => ({
    label: PLAN_CAPABILITIES[c].label,
    detail: PLAN_CAPABILITIES[c].detail,
    tag: "plan" as const,
    cells: Object.fromEntries(PLAN_ORDER.map((id) => [id, PLAN_FEATURES[id].capabilities.includes(c)])) as Record<PlanId, Cell>,
  }));

export const MATRIX_GROUPS: MatrixGroup[] = [
  {
    key: "scanning",
    title: "Scanning",
    // CORRECTED. This read "Every scan, public or private, draws on one monthly allowance" — which the
    // file's own header (line 4-6), `plans.ts:144-146` and `db/credits.ts:3` all contradict: an
    // anonymous PUBLIC scan is never metered and never touches the allowance. The intro was
    // contradicting the table three lines below it.
    intro: "Private scans draw on your monthly allowance; only private scans past it cost a credit. Public scans are always free and never metered.",
    rows: [
      {
        label: "Public repository scan",
        detail: "Any public repo, by anyone: the full report, radar and roadmap. Never metered on any plan — rate-limited and monthly-capped instead.",
        tag: "free",
        cells: all("Unlimited"),
      },
      {
        label: "Private repository scan",
        detail: "Your own private repos, through the GitHub App: free within your monthly allowance, then 1 credit each.",
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
        detail: "Watched repos rescanned on a schedule; each rescan of a private repo counts as one scan.",
        tag: "credit",
        cells: from("pro"),
        planned: true,
      },
      {
        label: "Buy extra scan credits",
        detail: "Top up prepaid credits for scans beyond your plan; they roll over and never expire.",
        tag: "plan",
        cells: from("pro"),
        planned: true,
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
      { label: "Org fleet dashboard", detail: "Rollups, leaderboard and the dimension heatmap.", tag: "plan", cells: from("pro"), planned: true },
      { label: "Regression + credit alerts", detail: "Slack-compatible pushes when a repo slips or credits run low.", tag: "plan", cells: from("pro"), planned: true },
      // Retention IS enforced (src/lib/db/retention.ts reads PlanFeature.retentionDays), so this row
      // is a real per-tier difference and carries no `planned` flag.
      { label: "Scan history", detail: "Progress trends over your retention window.", tag: "plan", cells: { free: "30 days", pro: "180 days", team: "1 year", enterprise: "Custom" } },
      { label: "Segments + comparisons", detail: "Slice the fleet by business unit and compare side by side.", tag: "plan", cells: from("team"), planned: true },
      { label: "Playbooks + planning", detail: "Turn gaps into tracked initiatives and goals.", tag: "plan", cells: from("team"), planned: true },
      // The GATED capabilities, ticked from the very array the entitlement gate indexes. These rows
      // used to be hand-typed with hand-typed `from(tier)` cells, so the matrix could promise a tier a
      // capability the gate refused (and it silently omitted Shared org memory and PDF export, both
      // gated and both unsold). Ungated selling points stay hand-written above and below.
      ...capabilityRows(),
      // Roles and the audit trail ship today; SAML/OIDC sign-in does NOT — the login is GitHub OAuth via
      // Supabase (src/lib/auth.ts). A ✓ here claimed a shipped capability. Under the Custom tier's
      // "adjustable, scoped with you" framing the honest cell is "Scoped", which is what the enquiry
      // form is for; the RBAC + audit half is stated separately below because it really is available.
      { label: "Roles · audit log", detail: "Owner/admin/member roles and a full audit trail.", tag: "plan", cells: from("pro") },
      { label: "SSO · SAML/OIDC", detail: "Directory sign-in and provisioning, scoped as part of a Custom plan.", tag: "plan", cells: { free: false, pro: false, team: false, enterprise: "Scoped" } },
      { label: "Hosting", detail: "Where Ascent and its inference run.", tag: "plan", cells: { free: "Shared cloud", pro: "Shared cloud", team: "Shared cloud", enterprise: "Your VPC / on-prem" } },
      { label: "Support", detail: "How fast you can expect an answer.", tag: "plan", cells: { free: "Community", pro: "Email", team: "Email", enterprise: "SLA you pick" } },
      { label: "Members / seats", detail: "How many teammates can share the org.", tag: "plan", cells: { free: "1", pro: "3", team: "10", enterprise: "Yours to set" }, planned: true },
    ],
  },
];

/** The one-sentence rule the whole matrix proves — reused across variants so copy can't drift. */
export const CREDIT_RULE =
  "Credits buy exactly one thing: a PRIVATE scan beyond your monthly allowance. Public scans, cached re-scans and every capability are free or included in your plan.";

/** The footnote the `planned` flag obliges. Rendered wherever a matrix variant renders the marker. */
export const PLANNED_NOTE =
  "Rows marked Planned are tier boundaries we intend to enforce and do not enforce yet: today every plan can use them. They are listed so the comparison is a roadmap you can hold us to, not a restriction you would discover later.";

/** Every row the matrix marks as an unenforced tier boundary. Exported for the drift test. */
export const PLANNED_ROW_LABELS: string[] = MATRIX_GROUPS.flatMap((g) => g.rows.filter((r) => r.planned).map((r) => r.label));
