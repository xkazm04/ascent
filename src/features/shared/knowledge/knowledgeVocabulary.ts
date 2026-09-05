// The Knowledge base tab's VOCABULARY: how each of the contract's eleven cell states and four repo
// stages reads — its label, its one-character glyph, its tone. Constants only; the derivations that
// use them live in `knowledgeModel.ts`. One file so the tree, the matrix, the board and the composer
// cannot disagree about what "unjudged" looks like.

import type { KnowledgeCellState, KnowledgeRepoStage } from "@/lib/org/knowledge-shape";

export const STATE_LABEL: Record<KnowledgeCellState, string> = {
  conformant: "Conformant",
  deviation: "Deviation",
  "not-applicable": "Not applicable",
  unknown: "Unjudged",
  candidate: "Candidate direction",
  accepted: "Direction accepted",
  deferred: "Direction deferred",
  declined: "Direction declined",
  "out-of-scope": "Out of scope",
  "out-of-domain": "Out of domain",
  "no-map": "No registry map",
};

/** The one-character reading in a dense grid. Unjudged is an em dash — never a tick, never a zero. */
export const STATE_GLYPH: Record<KnowledgeCellState, string> = {
  conformant: "•",
  deviation: "▮",
  "not-applicable": "◦",
  unknown: "—",
  candidate: "+",
  accepted: "↗",
  deferred: "…",
  declined: "×",
  "out-of-scope": "",
  "out-of-domain": "",
  "no-map": "",
};

/**
 * Cell tones. NOT the score ramp: a deviation is a decision someone recorded, not a failure to reach
 * a number, and red-to-green would turn a governance ledger into a leaderboard. The accent carries
 * the two states that ask for work (deviation, candidate); verdicts sit on the surface; absences
 * recede into the ink in three depths so "cannot be known" reads darker than "chose not to".
 */
export const STATE_CLASS: Record<KnowledgeCellState, string> = {
  deviation: "bg-accent/25 text-accent",
  conformant: "bg-surface/70 text-slate-300",
  "not-applicable": "bg-surface/40 text-slate-600",
  unknown: "bg-ink text-slate-500",
  candidate: "bg-accent/10 text-accent-soft",
  accepted: "bg-surface/40 text-slate-400",
  deferred: "bg-ink text-slate-600",
  declined: "bg-ink text-slate-700",
  "out-of-scope": "bg-ink/60 text-slate-800",
  "out-of-domain": "bg-ink/40 text-slate-800",
  "no-map": "bg-ink/20 text-slate-800",
};

/** Verdicts vs. absences — the two halves of the vocabulary, for legends and folds. */
export const VERDICT_STATES: readonly KnowledgeCellState[] = ["deviation", "conformant", "not-applicable", "unknown"];
export const ABSENCE_STATES: readonly KnowledgeCellState[] = [
  "candidate",
  "accepted",
  "deferred",
  "declined",
  "out-of-scope",
  "out-of-domain",
  "no-map",
];

/** Worst-wins rank, used when a row or column has to be summarised by ONE state. */
export const STATE_RANK: Record<KnowledgeCellState, number> = {
  deviation: 10,
  unknown: 9,
  candidate: 8,
  conformant: 7,
  accepted: 6,
  deferred: 5,
  "not-applicable": 4,
  declined: 3,
  "out-of-scope": 2,
  "out-of-domain": 1,
  "no-map": 0,
};

export const STAGE_LABEL: Record<KnowledgeRepoStage, string> = {
  populate: "Needs a context map",
  map: "Needs a registry map",
  conform: "Verdicts owed",
  current: "Current",
};

/** The registry's own verb for the next act on a repo — what the brief button says. */
export const STAGE_ACTION: Record<KnowledgeRepoStage, string> = {
  populate: "Populate contexts",
  map: "Build the map",
  conform: "Conform",
  current: "Nothing owed",
};

export const STAGE_ORDER: readonly KnowledgeRepoStage[] = ["populate", "map", "conform", "current"];
