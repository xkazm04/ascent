// Which of this organization's skills apply to the task in front of an agent — ranked, and every
// rank explained (moonshot #17). PURE: no Prisma, no clock, no network.
//
// ── WHAT THIS RANKS ON, AND THE PREMISE THAT TURNED OUT TO BE FALSE ─────────────────────────────
//
// The design this came from ranked skills against "the repo's sub-band dimensions" using
// `CatalogSkillEntry.applicability`. That field has no producer: it exists as an interface in
// `src/lib/registry/catalog.ts` and nothing writes it, and neither do `adopters` or `invokes30d`.
// `recordIndexResult` persists counts, usage totals and bundle metadata — no per-skill applicability.
// Ranking on it would have meant ranking on `undefined` for every skill in every org.
//
// So ranking is built from what IS persisted — `name`, `description`, `tags`, `category`,
// `adoptionCount`, `downloadCount` — plus ONE declared thing: `CATEGORY_DIMENSIONS`, a stated map
// from the closed skill-category set to the maturity dimensions a skill in that category plausibly
// moves. Declared, not inferred: it is a claim this repo makes and can be argued with, and every
// result that used it says so in its `why`.
//
// ── THE ONE RELEVANCE MODEL RULE ───────────────────────────────────────────────────────────────
//
// Term overlap, the same discipline `recallMemory` states for memory: this is a projection of stored
// rows, and a second, divergent relevance model beside the one the Skills tab shows would eventually
// disagree with it about which skill matters. Weighted (a hit in the name means more than a hit in a
// long description), deterministic, and stably tie-broken — the same query returns the same order.

import { LEVELS, levelForScore } from "@/lib/maturity/model";
import type { SkillCategory } from "@/lib/org/skill-categories";

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
/** Adoption is evidence other repos here found this useful — a tiebreak, never a ranking of its own. */
const ADOPTION_WEIGHT = 0.25;
const MAX_ADOPTION_BONUS = 1;

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

/**
 * Rank skills for a task. Deterministic and total: an empty query or an empty library yields an empty
 * list, never a throw.
 *
 * Ties break on adoption, then downloads, then name — a total order, so two calls with the same
 * inputs return the same sequence and a client can cache it.
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

    const nameHits = terms.filter((t) => name.includes(t));
    const tagHits = terms.filter((t) => tags.some((tag) => tag.includes(t)));
    const descHits = terms.filter((t) => description.includes(t));
    let score =
      nameHits.length * NAME_WEIGHT + tagHits.length * TAG_WEIGHT + descHits.length * DESCRIPTION_WEIGHT;

    if (nameHits.length) why.push(`Its name matches ${nameHits.join(", ")}.`);
    if (tagHits.length) why.push(`Tagged ${tagHits.join(", ")}.`);
    if (!nameHits.length && !tagHits.length && descHits.length) {
      why.push(`Its description mentions ${descHits.join(", ")}.`);
    }

    const dims = CATEGORY_DIMENSIONS[s.category as SkillCategory] ?? [];
    const weakHit = dims.filter((d) => weak.has(d));
    if (weakHit.length) {
      score += DIMENSION_WEIGHT;
      why.push(
        `This repository scores below its own level band on ${weakHit.join(", ")}, and "${s.category}" skills are declared to address ${dims.join(", ")}.`,
      );
    }

    if (s.adoptionCount > 0) {
      score += Math.min(MAX_ADOPTION_BONUS, ADOPTION_WEIGHT * Math.log(1 + s.adoptionCount));
      why.push(`Adopted by ${s.adoptionCount} ${s.adoptionCount === 1 ? "repository" : "repositories"} here.`);
    }

    return { s, score: Number(score.toFixed(4)), why };
  });

  return scored
    .filter((x) => x.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.s.adoptionCount - a.s.adoptionCount ||
        b.s.downloadCount - a.s.downloadCount ||
        a.s.name.localeCompare(b.s.name),
    )
    .slice(0, limit)
    .map(({ s, score, why }) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      category: s.category,
      tags: s.tags,
      adoptionCount: s.adoptionCount,
      downloadCount: s.downloadCount,
      // The agent is pointed at the source of truth rather than being asked to trust this projection.
      registryPath: s.registryPath,
      registryVersion: s.registryVersion,
      score,
      why,
    }));
}
