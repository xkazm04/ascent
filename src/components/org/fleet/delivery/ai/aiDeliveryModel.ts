// The model behind /delivery's "AI delivery intelligence" section (Table + Map views share it). Joins
// ascent's REAL per-repo git-derived AI signals (aiInvolvedRate, aiGovernedRate, review coverage, PR
// volume — from getOrgPrSignals.perRepo) with a spend/seats layer whose fidelity depends on what's
// connected in Integrations:
//   measured   — real per-repo usage (Claude Code OTel telemetry, getOrgUsageRollup.perRepo)
//   allocated  — a connected org-level total distributed to repos by AI-attributed PR volume
//   simulated  — a deterministic FNV-hash placeholder when nothing is connected
// The UI badges whichever applies. Everything adoption/governance-related is always real (git).
//
// Type-only import from @/lib/db (erased at compile) so the client Table/Map views can import this
// module's types without pulling server code into the bundle. Pure + server-safe.

import type { OrgPrSignals, OrgUsageRollup } from "@/lib/db";

export type Verdict = "working" | "ungoverned" | "idle" | "shadow" | "starter";
export type ModelFidelity = "measured" | "allocated" | "simulated";

/** Provider source id → display name for the tool column. */
const SOURCE_NAME: Record<string, string> = { "claude-code": "Claude Code", copilot: "Copilot", openai: "Codex" };

export const VERDICT_META: Record<Verdict, { label: string; hex: string; blurb: string }> = {
  working: { label: "Working", hex: "#22c55e", blurb: "AI shows up in the work and that work is reviewed" },
  ungoverned: { label: "Ungoverned", hex: "#ef4444", blurb: "Heavy AI involvement, little human review — the risk quadrant" },
  idle: { label: "Idle spend", hex: "#f97316", blurb: "Seats paid for, little AI reaching merged PRs — reclaim candidates" },
  shadow: { label: "Shadow AI", hex: "#a855f7", blurb: "AI fingerprints in git with no assigned enterprise plan" },
  starter: { label: "Starter", hex: "#64748b", blurb: "Low AI adoption and low spend — nothing to action yet" },
};

// Classification thresholds (tunable). Adoption = aiInvolvedRate; governance = aiGovernedRate.
const ADOPT_HI = 15; // ≥ this % of PRs AI-involved reads as "meaningfully adopted"
const GOV_HI = 60; // ≥ this % of AI PRs reviewed reads as "governed"
const SPEND_MEANINGFUL = 500; // $/mo above which paying-but-not-adopting reads as idle waste

// Simulated per-seat monthly price by tool (the connectors would replace this with real billing).
const SEAT_PRICE: Record<string, number> = {
  Copilot: 19,
  Cursor: 40,
  Claude: 30,
  Codex: 25,
  Gemini: 22,
  Devin: 60,
  Aider: 0, // OSS — a "plan" with no seat cost
};
const DEFAULT_TOOLS = ["Copilot", "Claude", "Cursor", "Codex"];

export interface AiRepoRoi {
  fullName: string;
  name: string;
  // ── real (git-derived) ──
  prs: number;
  aiInvolvedRate: number;
  aiPRs: number; // aiInvolvedRate × analyzed, rounded — AI-attributed PRs
  governedRate: number | null;
  reviewedRate: number | null;
  // ── spend layer (fidelity per the model's source) ──
  tool: string;
  planned: boolean; // has an assigned enterprise plan / seat allocation
  seats: number;
  monthlySpend: number;
  costPerAiPr: number | null; // null when there are no AI PRs (pure idle / no output)
  verdict: Verdict;
}

export interface AiDeliverySummary {
  repos: number;
  totalMonthlySpend: number;
  annualSpend: number;
  totalSeats: number;
  totalAiPRs: number;
  totalPRs: number;
  aiShareOfPRs: number; // % of PRs AI-involved across the fleet
  governedAiShare: number | null; // % of AI PRs that got an approving review (aiPR-weighted)
  idleSpend: number; // $/mo on repos classified idle — the reclaim target
  ungovernedSpend: number; // $/mo flowing into ungoverned AI work — the risk figure
  shadowRepos: number; // repos with AI evidence but no assigned plan
  costPerAiPr: number | null; // fleet efficiency: $/mo per AI PR
  counts: Record<Verdict, number>;
}

export interface AiDeliveryModel {
  summary: AiDeliverySummary;
  repos: AiRepoRoi[]; // concern-first: ungoverned → shadow → idle → working → starter, then by spend desc
  tools: { name: string; count: number }[]; // real detected tool taxonomy (fleet)
  /** Where the spend numbers came from — the UI badges this. */
  fidelity: ModelFidelity;
}

/** FNV-1a 32-bit — deterministic, dependency-free; used only to synthesize a stable spend layer. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// `spendReal` = the spend/seat/plan layer is a connected provider (measured|allocated), not the FNV
// placeholder. The two SPEND-DERIVED verdicts — `shadow` (adopted but no assigned plan) and `idle`
// (paying with little AI reaching PRs) — are only honest judgments when spend is real; in simulated
// mode they'd rest on fabricated dollars, so we fall through to the git-derived verdicts instead
// (adopted → ungoverned/working by real governance; not-adopted → starter). Adoption & governance are
// always real (git), so ungoverned/working/starter never depend on `spendReal`.
function classify(
  r: { aiInvolvedRate: number; governedRate: number | null; planned: boolean; monthlySpend: number },
  spendReal: boolean,
): Verdict {
  const adopted = r.aiInvolvedRate >= ADOPT_HI;
  if (adopted && spendReal && !r.planned) return "shadow"; // AI in the work, no assigned plan
  if (adopted && r.governedRate != null && r.governedRate < GOV_HI) return "ungoverned";
  if (adopted) return "working"; // governed (or too small a sample to fault)
  // Not meaningfully adopted: paying real money for it anyway = idle waste; otherwise just early.
  if (spendReal && r.monthlySpend >= SPEND_MEANINGFUL) return "idle";
  return "starter";
}

const VERDICT_ORDER: Verdict[] = ["ungoverned", "shadow", "idle", "working", "starter"];

/** Build the ROI model from the PR signals the delivery page already fetched, joined with connected
 *  provider usage when available. Fidelity: measured (real per-repo usage) > allocated (org total by
 *  git weight) > simulated (deterministic placeholder). Returns null when there are no per-repo PR rows
 *  (same empty contract as the rest of the tab). */
export function buildAiDeliveryModel(pr: OrgPrSignals | null, usage?: OrgUsageRollup | null): AiDeliveryModel | null {
  if (!pr || pr.perRepo.length === 0) return null;

  const fidelity: ModelFidelity = usage?.hasMeasured ? "measured" : usage?.hasAllocated ? "allocated" : "simulated";
  const toolNames = pr.tools.length > 0 ? pr.tools.map((t) => t.name) : DEFAULT_TOOLS;

  // Allocated-mode context: the connected org total (dominant source) distributed by AI-PR weight.
  const aiPrOf = (row: { analyzed: number; aiInvolvedRate: number }) => Math.round((row.analyzed * row.aiInvolvedRate) / 100);
  // W2 allocation weight: prefer TRAILER-grounded counts over the marker rate where a repo's scan
  // carries them. A commit trailer (Co-Authored-By / Assisted-By in the merge commit) is evidence the
  // tooling itself wrote, while the marker rate leans on self-declared PR descriptions/labels — so
  // trailer counts are the better proxy for where AI spend actually landed. Repos whose scans predate
  // trailer tracking (aiTrailerRate null) keep the marker-based weight; this only refines how a
  // connected ORG-LEVEL total is split. Fidelity note: this remains the "allocated" tier — it
  // complements the measured per-repo OTel path (which is untouched above), it does not replace it.
  const allocWeightOf = (row: { analyzed: number; aiInvolvedRate: number; aiTrailerRate: number | null }) =>
    row.aiTrailerRate != null ? Math.round((row.analyzed * row.aiTrailerRate) / 100) : aiPrOf(row);
  let allocSource = "";
  let allocTotalCents = 0;
  let allocSeats = 0;
  let weightSum = 1;
  if (fidelity === "allocated" && usage) {
    const top = usage.orgTotals.reduce<{ source: string; costCents: number } | null>((a, t) => (t.costCents > (a?.costCents ?? -1) ? t : a), null);
    allocSource = top?.source ?? usage.sources[0] ?? "";
    allocTotalCents = usage.orgTotals.reduce((s, t) => s + t.costCents, 0);
    allocSeats = usage.orgTotals.reduce((s, t) => s + t.seats, 0);
    weightSum = Math.max(1, pr.perRepo.reduce((s, row) => s + allocWeightOf(row), 0));
  }

  const repos: AiRepoRoi[] = pr.perRepo.map((row) => {
    const aiPRs = aiPrOf(row);
    let tool: string;
    let planned: boolean;
    let seats: number;
    let monthlySpend: number;

    if (fidelity === "measured" && usage) {
      const u = usage.perRepo[row.fullName.toLowerCase()];
      monthlySpend = u ? Math.round(u.costCents / 100) : 0;
      seats = u?.seats ?? 0;
      tool = u ? (SOURCE_NAME[u.source] ?? u.source) : "—";
      planned = monthlySpend > 0 || seats > 0; // has telemetry = tracked/paid
    } else if (fidelity === "allocated") {
      const w = allocWeightOf(row) / weightSum; // trailer-grounded when the scan carries it (W2)
      monthlySpend = Math.round((allocTotalCents / 100) * w);
      seats = Math.round(allocSeats * w);
      tool = SOURCE_NAME[allocSource] ?? allocSource ?? "—";
      planned = monthlySpend > 0;
    } else {
      const h = hash(row.fullName);
      const toolName = toolNames[h % toolNames.length]!;
      // ~85% of repos have an assigned plan; the rest are shadow-AI candidates. Seats spread by hash
      // (the demo seeds a near-constant PR count, so activity alone wouldn't separate them).
      planned = (h >>> 7) % 100 < 85;
      seats = 4 + ((h >>> 11) % 46); // 4..49
      monthlySpend = planned ? seats * (SEAT_PRICE[toolName] ?? 25) + ((h >>> 17) % 80) : 0;
      tool = toolName;
    }

    const verdict = classify({ aiInvolvedRate: row.aiInvolvedRate, governedRate: row.aiGovernedRate, planned, monthlySpend }, fidelity !== "simulated");
    return {
      fullName: row.fullName,
      name: row.name,
      prs: row.analyzed,
      aiInvolvedRate: row.aiInvolvedRate,
      aiPRs,
      governedRate: row.aiGovernedRate,
      reviewedRate: row.reviewedRate,
      tool,
      planned,
      seats,
      monthlySpend,
      costPerAiPr: aiPRs > 0 && monthlySpend > 0 ? Math.round(monthlySpend / aiPRs) : null,
      verdict,
    };
  });

  repos.sort(
    (a, b) => VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict) || b.monthlySpend - a.monthlySpend,
  );

  const counts: Record<Verdict, number> = { working: 0, ungoverned: 0, idle: 0, shadow: 0, starter: 0 };
  for (const r of repos) counts[r.verdict]++;

  const totalMonthlySpend = repos.reduce((s, r) => s + r.monthlySpend, 0);
  const totalSeats = repos.reduce((s, r) => s + r.seats, 0);
  const totalAiPRs = repos.reduce((s, r) => s + r.aiPRs, 0);
  const totalPRs = repos.reduce((s, r) => s + r.prs, 0);
  const idleSpend = repos.filter((r) => r.verdict === "idle").reduce((s, r) => s + r.monthlySpend, 0);
  const ungovernedSpend = repos.filter((r) => r.verdict === "ungoverned").reduce((s, r) => s + r.monthlySpend, 0);

  // Governed AI share: aiPR-weighted mean of governedRate over repos that have a sample.
  let govWeighted = 0;
  let govDenom = 0;
  for (const r of repos) {
    if (r.governedRate != null && r.aiPRs > 0) {
      govWeighted += r.governedRate * r.aiPRs;
      govDenom += r.aiPRs;
    }
  }

  return {
    fidelity,
    tools: pr.tools,
    repos,
    summary: {
      repos: repos.length,
      totalMonthlySpend,
      annualSpend: totalMonthlySpend * 12,
      totalSeats,
      totalAiPRs,
      totalPRs,
      aiShareOfPRs: totalPRs > 0 ? Math.round((totalAiPRs / totalPRs) * 100) : 0,
      governedAiShare: govDenom > 0 ? Math.round(govWeighted / govDenom) : null,
      idleSpend,
      ungovernedSpend,
      shadowRepos: counts.shadow,
      costPerAiPr: totalAiPRs > 0 && totalMonthlySpend > 0 ? Math.round(totalMonthlySpend / totalAiPRs) : null,
      counts,
    },
  };
}

/** Compact money formatter for the readouts: $1,240 · $12.4k · $1.2M. */
export function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toLocaleString()}`;
}
