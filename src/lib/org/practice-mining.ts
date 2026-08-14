// Mining the org's OWN practice shapes (W6) — the house pattern, derived from what its strongest
// repos actually agree on.
//
// The static catalog (src/lib/practices.ts) describes a generic good practice, identically for every
// customer. This derives *this org's* practice: the headings its best guidance files share, the
// layout its harnesses share. That is the half of `VISION-TRANSITION.md` §Pillar 2 that never
// shipped — "mine those exemplars, templatize their SHAPE, and systematically offer it to the
// teams/repos that lack it".
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE HOUSE PATTERN IS AGREEMENT, NOT THE BEST REPO'S COPY.
//
// The tempting implementation is "take the highest-scoring repo's outline and hand it to everyone".
// That is one team's document promoted to a standard nobody agreed to, and the first reader who
// recognizes it as *their* file will read the whole feature as surveillance rather than reuse.
//
// So a heading enters the house pattern only when at least MIN_AGREEMENT exemplars carry it. What
// comes out is genuinely shared structure — and where the org has no shared structure, the honest
// result is a SHORT pattern or none at all, not a synthesized one.
//
// EVERY MINED ITEM CARRIES ITS EVIDENCE: how many exemplars agreed, and which repos they were. A
// suggestion an engineer cannot audit is a suggestion they are entitled to ignore.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

import { PRACTICES } from "@/lib/practices";
import type { RepoPracticeShape } from "@/lib/analyze/practice-shape";

/** A repo's shape plus the score that decides whether it is an exemplar for a given dimension. */
export interface ShapeSource {
  repoFullName: string;
  shape: RepoPracticeShape;
  /** Per-dimension scores from the repo's latest scan, keyed "D1".."D9". */
  dims: Record<string, number>;
}

/** A repo scores at or above this on a practice's dimension to be treated as an exemplar of it. */
export const EXEMPLAR_FLOOR = 70;
/** Below this, the repo is a candidate to receive the practice. Mirrors getOrgPractices' gap floor. */
export const GAP_CEILING = 40;
/** Exemplars that must independently carry a heading before it counts as the house pattern. */
export const MIN_AGREEMENT = 2;

export interface MinedLine {
  /** The heading or path segment, verbatim from the org's own artifacts. */
  text: string;
  /** How many exemplars carried it — the evidence for calling it "the house pattern". */
  agreement: number;
}

export interface MinedPractice {
  practiceId: string;
  label: string;
  dimId: string;
  /** Repos scoring at/above the floor on this dimension AND carrying a shape for it. */
  exemplars: string[];
  /** Repos below the gap ceiling — who this would be offered to. */
  gapRepos: string[];
  /** The shared outline, most-agreed first. Empty when the exemplars share no structure. */
  outline: MinedLine[];
  /** The shared layout, same rule. */
  layout: MinedLine[];
  /**
   * True when there is a real house pattern to offer (≥1 agreed line AND ≥1 gap repo). False means
   * the static starter is still the best available answer — which is stated, not hidden.
   */
  offerable: boolean;
}

/** Normalize a heading for agreement counting: case- and punctuation-insensitive, level-preserving. */
function agreementKey(line: string): string {
  const m = /^(#+)\s+(.*)$/.exec(line);
  const level = m ? m[1]!.length : 0;
  const text = (m ? m[2]! : line)
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return `${level}:${text}`;
}

/**
 * Count agreement across exemplars, returning the lines at least `min` of them carry.
 *
 * Counts DISTINCT REPOS, not occurrences: a repo with three ADRs that all say "## Decision" agrees
 * once, or a single verbose repo could manufacture a house pattern by itself.
 */
function agreed(perRepo: Map<string, string[]>, min: number): MinedLine[] {
  const counts = new Map<string, { text: string; repos: Set<string> }>();
  for (const [repo, lines] of perRepo) {
    for (const key of new Set(lines.map(agreementKey))) {
      const original = lines.find((l) => agreementKey(l) === key) ?? key;
      const e = counts.get(key) ?? { text: original, repos: new Set<string>() };
      e.repos.add(repo);
      counts.set(key, e);
    }
  }
  return [...counts.values()]
    .filter((e) => e.repos.size >= min)
    .map((e) => ({ text: e.text, agreement: e.repos.size }))
    // Most-agreed first; ties alphabetical so the output is stable across runs.
    .sort((a, b) => b.agreement - a.agreement || a.text.localeCompare(b.text));
}

/**
 * Mine the org's house pattern per practice. Pure over its inputs.
 *
 * A practice with fewer than MIN_AGREEMENT exemplars yields an empty pattern and `offerable: false`
 * — the honest answer when an org has one strong repo, since one repo's document is not a standard.
 */
export function minePracticeShapes(sources: ShapeSource[]): MinedPractice[] {
  return PRACTICES.map((p) => {
    const withShape = sources.filter((s) => s.shape.entries.some((e) => e.practiceId === p.id));
    const exemplars = withShape.filter((s) => (s.dims[p.dimId] ?? 0) >= EXEMPLAR_FLOOR);
    const gapRepos = sources
      .filter((s) => (s.dims[p.dimId] ?? 0) < GAP_CEILING)
      .map((s) => s.repoFullName)
      .sort();

    const outlineByRepo = new Map<string, string[]>();
    const layoutByRepo = new Map<string, string[]>();
    for (const s of exemplars) {
      const mine = s.shape.entries.filter((e) => e.practiceId === p.id);
      const outline = mine.flatMap((e) => e.outline);
      // Layout agreement is on the last path SEGMENT, not the full path: `evals/golden/x.yaml` and
      // `packages/api/evals/golden/y.yaml` are the same practice in two places, and comparing full
      // paths would score them as disagreement.
      const layout = mine.flatMap((e) => e.layout.map((path) => path.split("/").slice(-2).join("/")));
      if (outline.length) outlineByRepo.set(s.repoFullName, outline);
      if (layout.length) layoutByRepo.set(s.repoFullName, layout);
    }

    const outline = agreed(outlineByRepo, MIN_AGREEMENT);
    const layout = agreed(layoutByRepo, MIN_AGREEMENT);
    return {
      practiceId: p.id,
      label: p.label,
      dimId: p.dimId,
      exemplars: exemplars.map((s) => s.repoFullName).sort(),
      gapRepos,
      outline,
      layout,
      offerable: (outline.length > 0 || layout.length > 0) && gapRepos.length > 0,
    };
  });
}

/**
 * Render a mined practice as the starter lines a PR would carry — the same `string[]` shape the
 * static catalog's `starter` uses, so the artifact builder consumes either without branching.
 *
 * Returns null when nothing was mined, which is the signal to fall back to the static starter. The
 * caller must SAY which it used: "your own pattern, from 3 repos" and "a generic starter" are very
 * different claims to put in front of an engineer.
 */
export function minedStarter(m: MinedPractice): string[] | null {
  if (!m.offerable) return null;
  const lines = m.outline.map((l) => l.text.replace(/^#+\s*/, ""));
  const paths = m.layout.map((l) => l.text);
  const out = [...lines, ...paths];
  return out.length ? out : null;
}
