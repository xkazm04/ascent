// The Knowledge base tab's VOCABULARY: how each of the contract's eleven cell states and four repo
// stages reads — its label, its one-character glyph, its tone. Constants only; the derivations that
// use them live in `knowledgeModel.ts`. One file so the tree, the matrix, the board and the composer
// cannot disagree about what "unjudged" looks like.
//
// ## Two axes, one canonical
//
// This file names the DOMAIN axis: WHICH of the registry's eleven classifications a cell carries
// (`declined` is not `deferred`, `out-of-scope` is not `out-of-domain`). The kit's `VizState`
// (`@/components/org/viz`) names the EPISTEMIC axis: whether we MEASURED it, whether somebody merely
// DECLARED it, whether nothing judged it, whether there is no measurement at all.
//
// `CELL_VIZ_STATE` below is the thin mapping from this file's axis onto the kit's, and the kit is
// canonical: every hatch, dash, void, opacity, swatch and caveat sentence on this tab comes from
// `@/components/org/viz` through that map. Nothing here re-defines one. What stays local is only the
// part the six states genuinely cannot carry — the eleven labels, the eleven glyphs, the worst-wins
// rank, and the reason each absence is an absence.

import type { VizState } from "@/components/org/viz";
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

/**
 * The DOMAIN axis → the kit's EPISTEMIC axis. The one place the two vocabularies meet.
 *
 *   conformant / deviation   a verdict `/conform` wrote against evidence → **measured**
 *   not-applicable           a person ruled it does not apply → **decided**
 *   accepted/deferred/declined  a direction decision in the repo's ledger → **decided**
 *   unknown / candidate      nothing judged it — a pair nobody read, or a direction nobody
 *                            opened → **not-judged** (hatched; never counted as passing)
 *   out-of-scope / out-of-domain  the repo's manifest DECLARES the boundary and no observation
 *                            was ever attempted → **declared**
 *   no-map                   there is no `.ai/registry-map.json`: nothing above can be known →
 *                            **missing** (a void, never a zero)
 */
export const CELL_VIZ_STATE: Record<KnowledgeCellState, VizState> = {
  conformant: "measured",
  deviation: "measured",
  "not-applicable": "decided",
  unknown: "not-judged",
  candidate: "not-judged",
  accepted: "decided",
  deferred: "decided",
  declined: "decided",
  "out-of-scope": "declared",
  "out-of-domain": "declared",
  "no-map": "missing",
};

/**
 * Why THIS state is this state — the registry's own classification reason, one sentence. Rides in a
 * cell's `title` and a legend row's tooltip beside the kit's canonical `STATE_HINT`: the kit says
 * what the encoding means, this says why this cell earned it. (D) target for the wire contract's
 * "absence is never zero" comment, which no reader of the UI could previously see.
 */
export const CELL_REASON: Record<KnowledgeCellState, string> = {
  conformant: "The repo's own /conform read the golden path against this context and found no gap.",
  deviation: "The repo's own /conform recorded a gap here; the evidence is the file:line beside it.",
  "not-applicable": "Judged and ruled out: the subject does not govern this context.",
  unknown: "The matcher paired them and nobody has judged the pair yet.",
  candidate: "In domain, in scope, no decision recorded, and no context resonates — a direction, not a verdict.",
  accepted: "A direction the repo accepted; contexts to carry it do not exist yet.",
  deferred: "A direction the repo deferred; it is on the ledger, not on the map.",
  declined: "A direction the repo declined, kept on the ledger so the reasoning stays auditable.",
  "out-of-scope": "The repo's manifest scope block excludes this subject or its category.",
  "out-of-domain": "The repo's manifest does not declare this subject's bundle at all.",
  "no-map": "The repo has no .ai/registry-map.json, so nothing about this pair can be known.",
};

/**
 * A repo's pipeline stage on the epistemic axis: `populate` has no context map, so nothing about it
 * has been measured (a void); `map` and `conform` have pairs nobody judged (a hatch); `current` is
 * judged against the digest the registry publishes today (measured).
 */
export const STAGE_VIZ_STATE: Record<KnowledgeRepoStage, VizState> = {
  populate: "missing",
  map: "not-judged",
  conform: "not-judged",
  current: "measured",
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
