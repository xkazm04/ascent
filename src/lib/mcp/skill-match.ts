// Which of this organization's skills apply to the task in front of an agent — ranked, and every
// rank explained (moonshot #17). PURE: no Prisma, no clock, no network.
//
// ── WHAT THIS RANKS ON ──────────────────────────────────────────────────────────────────────────
//
// Term overlap is a RELEVANCE FILTER, not the ranking — the same discipline `recallMemory` states
// for memory. A skill that does not hit the task in its name, tags or description is out, however
// often it has been invoked: that is a popular skill for a different task.
//
// Among matches, ranking uses OBSERVED INVOKES: the live channel moonshot #19 actually produces
// (MCP `report_skill_invoke`, the CLI hook drain, the registry `usage/` lane), folded by
// `skillUsageMap` — the same number the Skills tab's dormancy badge reads. `CatalogSkillEntry.
// applicability` / `adopters` / `invokes30d` still have no producer; ranking on them would still
// be ranking on `undefined`. The count that does have a producer is `SkillUsage.invokes`.
//
// Plus the declared `CATEGORY_DIMENSIONS` nudge when the named repo has sub-band dimensions, and
// adoption as a weaker term — running a skill outranks copying it, the same inequality the
// dormancy badge uses. Declared, not inferred: the affinity is a claim this repo makes and can be
// argued with, and every result that used it says so in its `why`.

import { LEVELS, levelForScore } from "@/lib/maturity/model";
import { isSkillCategory, type SkillCategory } from "@/lib/org/skill-categories";

/**
 * DECLARED category → dimension affinity. Which dimensions of the maturity model a skill of each
 * category plausibly moves, stated by this repo rather than measured.
 *
 * It is a claim, and the honest reading of a claim is that it can be wrong: a `security` skill that
 * happens to be about test fixtures will still be boosted for a weak D9. That is why the affinity is
 * a tie-level nudge rather than the primary term, and why every boosted result names the dimension
 * that caused it — a reader who disagrees can see exactly what to disagree with.
 *
 * `other` maps to an EMPTY list on purpose: "this category tells us nothing about which dimension a
 * skill moves" is a real answer, and inventing an affinity for the catch-all bucket would spray a
 * boost across every uncategorized skill in the library.
 */
export const CATEGORY_DIMENSIONS: Record<SkillCategory, string[]> = {
  "ci-cd": ["D3"], // CI/CD & Delivery
  testing: ["D2", "D6"], // Automated Testing; Code Quality & Guardrails
  security: ["D9"], // Supply Chain & Security
  "ai-native": ["D1", "D4"], // AI Tooling & Conventions; Agentic Workflows
  docs: ["D5"], // Documentation & Knowledge
  workflow: ["D7", "D8"], // Commit & Velocity Signals; AI Process & Harness
  other: [],
};

/** The persisted fields ranking is allowed to see. Structurally satisfied by db `SkillRow`. */
export interface RankableSkill {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  adoptionCount: number;
  downloadCount: number;
  registryPath: string | null;
  registryVersion: string | null;
  /**
   * Times this skill has actually been RUN here. Optional: an absent value is *no evidence*, scored
   * as 0, never as "not useful" — the same reading `RecallCandidate.citedCount` gives a memory that
   * predates the citation channel. The caller supplies `SkillUsage.invokes`; this module never
   * fetches.
   */
  invokes?: number;
}

export interface RankedSkill {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  adoptionCount: number;
  downloadCount: number;
  registryPath: string | null;
  registryVersion: string | null;
  invokes: number;
  score: number;
  /** Why this ranked where it did, in the reader's language. Never empty for a returned skill. */
  why: string[];
}

/** A hit in the name is a stronger signal than a hit in a paragraph of prose. */
const NAME_WEIGHT = 3;
const TAG_WEIGHT = 2;
const DESCRIPTION_WEIGHT = 1;
/** The declared category→dimension nudge. Deliberately smaller than a single name hit. */
const DIMENSION_WEIGHT = 2;
/**
 * Observed-invoke evidence. 0.7·ln(1+n): four runs ≈ +1.13, which is the load-bearing inequality —
 * modest proven use must outrank the adoption cap, because running a skill is stronger evidence
 * than copying its text (the same claim `skill-usage.ts` makes for the dormancy badge).
 *
 * Capped below a name-vs-description gap so a heavily invoked skill that only mentions the task in
 * prose cannot outrank an unused skill named for it. Among equal term quality, invokes decide.
 */
export const INVOKE_WEIGHT = 0.7;
export const MAX_INVOKE_BONUS = 1.6;
/** Adoption is evidence other repos here found this useful — weaker than an invoke, by construction. */
const ADOPTION_WEIGHT = 0.25;
export const MAX_ADOPTION_BONUS = 1;

const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with", "is", "are", "was",
  "be", "it", "this", "that", "we", "our", "you", "your", "how", "what", "why", "when", "which",
  "should", "would", "can", "could", "at", "by", "from", "as", "do", "does", "did", "my", "me",
]);

/** Lowercased, de-stopworded terms of ≥3 characters. Pure. */
export function queryTerms(q: string): string[] {
  return Array.from(
    new Set(
      (q ?? "")
        .toLowerCase()
        .split(/[^a-z0-9/._-]+/)
        .filter((t) => t.length > 2 && !STOP.has(t)),
    ),
  );
}

/**
 * The dimensions a repo is weak in, relative to the level its own overall score claims: any dimension
 * scoring below the floor of the repo's level band.
 *
 * "Sub-band" is defined against the repo's OWN band rather than a fixed threshold on purpose. A fixed
 * 60 would call every dimension of an L2 repo weak (which is true and useless — it needs everything)
 * and none of an L5 repo's (which hides the one thing dragging it). Against its own band, the answer
 * is always the actionable one: "here is where you are not yet the level you already are".
 */
export function weakDimensionsFor(
  overall: number,
  dims: { dimId: string; score: number }[],
): string[] {
  const band = levelForScore(overall).band[0];
  return dims
    .filter((d) => d.score < band)
    .sort((a, b) => a.score - b.score || a.dimId.localeCompare(b.dimId))
    .map((d) => d.dimId);
}

/** The lowest level's floor, exposed so a caller can explain why nothing was ever sub-band. */
export const LOWEST_BAND_FLOOR = LEVELS[0]!.band[0];

export interface RankOptions {
  /**
   * The repo's sub-band dimensions, or NULL when there is no scan to derive them from.
   *
   * `null` and `[]` are different facts and must never be conflated: `[]` says "we looked and this
   * repo is not below its own band anywhere", `null` says "we could not look". A caller defaulting
   * this to `[]` would report a scanned, healthy repo and an unscanned one identically — the exact
   * fabricated-zero failure the product exists to avoid.
   */
  weakDims: string[] | null;
  limit?: number;
}

/** Sub-linear invoke evidence. Absent, non-finite or non-positive is 0 — no evidence, not a penalty. */
export function invokeBonus(invokes: number | undefined): number {
  if (invokes == null || !Number.isFinite(invokes) || invokes <= 0) return 0;
  return Math.min(MAX_INVOKE_BONUS, INVOKE_WEIGHT * Math.log(1 + invokes));
}

/**
 * Rank skills for a task. Deterministic and total: an empty query or an empty library yields an empty
 * list, never a throw.
 *
 * Term overlap is the filter. Among matches, observed invokes rank above adoption. Remaining ties
 * break on downloads, then name and ID — a total order, so two calls with the same inputs return the
 * same sequence and a client can cache it.
 */
export function rankSkills(query: string, skills: RankableSkill[], opts: RankOptions): RankedSkill[] {
  const terms = queryTerms(query);
  const weak = new Set(opts.weakDims ?? []);
  const limit = Math.max(1, Math.min(25, opts.limit ?? 5));

  const scored = (skills ?? []).map((s) => {
    const why: string[] = [];
    const name = s.name.toLowerCase();
    const description = (s.description ?? "").toLowerCase();
    const tags = (s.tags ?? []).map((t) => t.toLowerCase());
    const invokes = s.invokes != null && Number.isFinite(s.invokes) && s.invokes > 0 ? s.invokes : 0;

    const nameHits = terms.filter((t) => name.includes(t));
    const tagHits = terms.filter((t) => tags.some((tag) => tag.includes(t)));
    const descHits = terms.filter((t) => description.includes(t));
    // FILTER, not ranking: a skill with no lexical hit is out even if it has been invoked a thousand
    // times. Adoption / invoke bonuses must not leak unmatched skills into the result.
    const overlap =
      nameHits.length * NAME_WEIGHT + tagHits.length * TAG_WEIGHT + descHits.length * DESCRIPTION_WEIGHT;
    if (overlap <= 0) return { s, score: 0, why, invokes: 0 };

    let score = overlap;
    if (nameHits.length) why.push(`Its name matches ${nameHits.join(", ")}.`);
    if (tagHits.length) why.push(`Tagged ${tagHits.join(", ")}.`);
    if (!nameHits.length && !tagHits.length && descHits.length) {
      why.push(`Its description mentions ${descHits.join(", ")}.`);
    }

    const dims = isSkillCategory(s.category) ? CATEGORY_DIMENSIONS[s.category] : [];
    const weakHit = dims.filter((d) => weak.has(d));
    if (weakHit.length) {
      score += DIMENSION_WEIGHT;
      why.push(
        `This repository scores below its own level band on ${weakHit.join(", ")}, and "${s.category}" skills are declared to address ${dims.join(", ")}.`,
      );
    }

    if (invokes > 0) {
      score += invokeBonus(invokes);
      why.push(`Invoked ${invokes} ${invokes === 1 ? "time" : "times"} here.`);
    }

    if (s.adoptionCount > 0) {
      score += Math.min(MAX_ADOPTION_BONUS, ADOPTION_WEIGHT * Math.log(1 + s.adoptionCount));
      why.push(`Adopted by ${s.adoptionCount} ${s.adoptionCount === 1 ? "repository" : "repositories"} here.`);
    }

    return { s, score: Number(score.toFixed(4)), why, invokes };
  });

  return scored
    .filter((x) => x.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.invokes - a.invokes ||
        b.s.adoptionCount - a.s.adoptionCount ||
        b.s.downloadCount - a.s.downloadCount ||
        a.s.name.localeCompare(b.s.name) || a.s.id.localeCompare(b.s.id),
    )
    .slice(0, limit)
    .map(({ s, score, why, invokes }) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      category: s.category,
      tags: s.tags,
      adoptionCount: s.adoptionCount,
      downloadCount: s.downloadCount,
      invokes,
      // The agent is pointed at the source of truth rather than being asked to trust this projection.
      registryPath: s.registryPath,
      registryVersion: s.registryVersion,
      score,
      why,
    }));
}
