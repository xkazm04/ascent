// The shape of the /delivery "AI delivery intelligence" model, split out of aiDeliveryModel.ts so the
// builder file stays inside the 200-line cap. Types only (plus the verdict palette), no logic — the
// client Table/Map views import these without pulling the builder in.
//
// Re-exported from ./aiDeliveryModel, which remains the canonical import path for call sites.

import type { Fidelity } from "@/lib/integrations/providers";

export type Verdict = "working" | "ungoverned" | "idle" | "shadow" | "starter";
export type ModelFidelity = "measured" | "allocated" | "none";

// ── The connector vocabulary ↔ the model vocabulary (D32) ────────────────────────────────────────
// `Fidelity` (src/lib/integrations/providers.ts) says what a CONNECTOR can do; `ModelFidelity` says what
// the built model ended up WITH. Two genuinely different statements — a Copilot org is `seats-only`
// (the vendor never reports spend) while the model is `none` (no cost figure exists to show) — so they
// stay two types. What changes is that the correspondence is now TYPED in both directions instead of
// living in a reader's head: each Record is total over its key union, so adding a tier to either
// vocabulary fails to compile until it has been mapped. The money columns depend on this alignment.

/** What a connector at tier `f` can contribute to the model's spend layer, at best. */
const MODEL_FIDELITY_OF_CONNECTOR: Record<Fidelity, ModelFidelity> = {
  measured: "measured",
  allocated: "allocated",
  // Seats and engagement but no spend: there is no cost figure, so the model's spend layer is absent.
  "seats-only": "none",
};

export function modelFidelityOfConnector(f: Fidelity): ModelFidelity {
  return MODEL_FIDELITY_OF_CONNECTOR[f];
}

/** The reverse totality check: which connector tiers can produce each model state. `none` is reachable
 *  from `seats-only` AND from nothing being connected at all — which is why it is not the same member. */
export const CONNECTOR_TIERS_BEHIND: Record<ModelFidelity, readonly Fidelity[]> = {
  measured: ["measured"],
  allocated: ["allocated"],
  none: ["seats-only"],
};

// ── Per-figure provenance (D31) ──────────────────────────────────────────────────────────────────
// One badge on the whole model covered a surface that mixes a git-MEASURED adoption rate with a
// vendor-ALLOCATED cost figure, so the reader either distrusted a solid number or trusted an estimated
// one. Provenance now travels per figure GROUP rather than per field: three groups is a display a
// designer will actually keep, where a badge on every cell gets suppressed and we end up back here.

export type FigureProvenance = "git-measured" | ModelFidelity;
/** `adoption` = derived from git history and always real. `spend` = the connected cost layer. `mixed` =
 *  a figure combining both, which can only be as good as its weaker input. */
export type FigureGroup = "adoption" | "spend" | "mixed";

export const FIGURE_GROUP_META: Record<FigureGroup, { label: string; note: string }> = {
  adoption: { label: "From git", note: "PR volume, AI involvement, review coverage — measured from the repo's own history" },
  spend: { label: "Spend layer", note: "seats and cost, at whatever fidelity the connected provider reports" },
  mixed: { label: "Cost per unit", note: "git counts divided by spend — no better than the spend figure it uses" },
};

/** Which group each published figure belongs to. Named fields, so a render site asks by field rather
 *  than deciding for itself which badge a number deserves. */
export const FIGURE_GROUP_OF = {
  prs: "adoption",
  aiInvolvedRate: "adoption",
  aiPRs: "adoption",
  governedRate: "adoption",
  reviewedRate: "adoption",
  totalPRs: "adoption",
  totalAiPRs: "adoption",
  aiShareOfPRs: "adoption",
  governedAiShare: "adoption",
  seats: "spend",
  monthlySpend: "spend",
  totalSeats: "spend",
  totalMonthlySpend: "spend",
  annualSpend: "spend",
  idleSpend: "spend",
  ungovernedSpend: "spend",
  costPerAiPr: "mixed",
} as const satisfies Record<string, FigureGroup>;

export type ProvenanceMap = Record<FigureGroup, FigureProvenance>;

/** Provenance per group for a model built at `fidelity`. The `mixed` group takes the WEAKER of its two
 *  inputs — a cost-per-AI-PR is an allocated figure the moment its cost half is allocated. */
export function provenanceOf(fidelity: ModelFidelity): ProvenanceMap {
  return { adoption: "git-measured", spend: fidelity, mixed: fidelity };
}

/** The badge a single named figure deserves. */
export function provenanceOfFigure(p: ProvenanceMap, figure: keyof typeof FIGURE_GROUP_OF): FigureProvenance {
  return p[FIGURE_GROUP_OF[figure]];
}

export const VERDICT_META: Record<Verdict, { label: string; hex: string; blurb: string }> = {
  working: { label: "Working", hex: "#22c55e", blurb: "AI shows up in the work and that work is reviewed" },
  ungoverned: { label: "Ungoverned", hex: "#ef4444", blurb: "Heavy AI involvement, little human review: the risk quadrant" },
  idle: { label: "Idle spend", hex: "#f97316", blurb: "Seats paid for, little AI reaching merged PRs: reclaim candidates" },
  shadow: { label: "Shadow AI", hex: "#a855f7", blurb: "AI fingerprints in git with no assigned enterprise plan" },
  starter: { label: "Starter", hex: "#64748b", blurb: "Low AI adoption and low spend, nothing to action yet" },
};

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
  /** Where the SPEND numbers came from — the UI badges this. Kept as the headline scalar; it is the
   *  `spend` entry of `provenance` and must never disagree with it. */
  fidelity: ModelFidelity;
  /** Provenance per figure group (D31), so the adoption numbers are not badged with the spend layer's
   *  fidelity and vice versa. Read it through `provenanceOfFigure` at a render site. */
  provenance: ProvenanceMap;
}
