// The shape of the /delivery "AI delivery intelligence" model, split out of aiDeliveryModel.ts so the
// builder file stays inside the 200-line cap. Types only (plus the verdict palette), no logic — the
// client Table/Map views import these without pulling the builder in.
//
// Re-exported from ./aiDeliveryModel, which remains the canonical import path for call sites.

export type Verdict = "working" | "ungoverned" | "idle" | "shadow" | "starter";
export type ModelFidelity = "measured" | "allocated" | "none";

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
  /** Where the spend numbers came from — the UI badges this. */
  fidelity: ModelFidelity;
}
