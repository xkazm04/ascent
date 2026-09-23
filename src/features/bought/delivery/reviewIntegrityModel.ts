// The review-integrity read for the Delivery tab: what the fleet's review coverage is made of.
//
// "Review coverage 95%" counts every approval the platform recorded. The same scans also counted how
// many of those approvals were the author's own (`selfApproved`) and how many landed within
// FAST_APPROVAL_MAX_MINUTES of the PR opening (`fastApproval`), and until now only the single-repo
// report showed them. This module turns each repo's persisted counts (PrRepoRow.integrity) into:
//
//  - two fleet shares, POOLED through the one fleet fold (fleet-rate-pool.ts `poolFleetRate`: summed
//    counts over summed populations, floored by REVIEW_INTEGRITY_MIN_SAMPLE on the POOL), never a
//    mean of per-repo percentages;
//  - a per-repo state: measured, below-floor (counts still enter the pool, no percentage of its own)
//    or not-persisted (the scan predates the book);
//  - the question list: repos whose approvals mostly land within minutes.
//
// Unlike the band's rates, a repo without the book is EXCLUDED from the pool rather than forcing a
// volume-weighted fallback: these two rates have no bare scalar a weighted mean could fall back on.
// The exclusion is stated beside the number ("1 repo predates these counts") so the smaller pool
// never reads as the whole fleet. Every claim is about a repository's approvals; no login and no
// reviewer is ever carried, per the people-analytics framing (a share to ask about, not a verdict).
//
// Pure data, no JSX: ReviewIntegrityStrip renders it and derivePriorities asks the question.

import { FAST_APPROVAL_MAX_MINUTES, RATE_BASIS, REVIEW_INTEGRITY_MIN_SAMPLE } from "@/lib/analyze/pr-thresholds";
import { poolFleetRate, type RateCounts } from "@/lib/db/fleet-rate-pool";
import type { PrRepoRow } from "@/lib/db";

export type IntegrityRateId = "selfApproved" | "fastApproval";
export const INTEGRITY_RATE_IDS: readonly IntegrityRateId[] = ["selfApproved", "fastApproval"];

/** A repo's fast-approval share at or above this (with a floored sample) is worth asking about. */
export const FAST_APPROVAL_QUESTION_SHARE = 50;

export type RepoIntegrityState = "measured" | "below-floor" | "not-persisted";

export interface RepoIntegrityReading {
  state: RepoIntegrityState;
  /** Null unless `measured`: under the floor or unpersisted, no percentage is published. */
  percent: number | null;
  count: number | null;
  population: number | null;
}

export interface RepoIntegrity {
  name: string;
  fullName: string;
  selfApproved: RepoIntegrityReading;
  fastApproval: RepoIntegrityReading;
}

export interface FleetIntegrityReading {
  id: IntegrityRateId;
  /** Pooled share; null when nothing was pooled or the pool is under the floor. */
  percent: number | null;
  count: number;
  population: number;
  /** Repos whose counts entered the pool. */
  repos: number;
  /** Repos excluded because their scan predates these counts. */
  legacyRepos: number;
  /** The counts in the reader's words, e.g. "12 of 25 approved PRs". */
  basis: string;
  /** "1 repo predates these counts", or null when every repo carried them. */
  legacyNote: string | null;
  /** RATE_BASIS[id].caveat, in on-page punctuation (no em dash). */
  caveat: string;
}

export interface IntegrityQuestion {
  name: string;
  fullName: string;
  count: number;
  population: number;
  percent: number;
  sentence: string;
}

export interface ReviewIntegrityModel {
  /** Null when no repo's scan carried either count: the strip renders a void, never a 0%. */
  fleet: Record<IntegrityRateId, FleetIntegrityReading> | null;
  repos: RepoIntegrity[];
  questions: IntegrityQuestion[];
}

const POPULATION_WORDS: Record<IntegrityRateId, string> = {
  selfApproved: "human-authored merged PRs",
  fastApproval: "approved PRs",
};

const counts = (r: PrRepoRow, id: IntegrityRateId): RateCounts | null => r.integrity?.[id] ?? null;
const repoWord = (n: number) => `${n} repo${n === 1 ? "" : "s"}`;

/** Page copy never carries an em dash; the shared RATE_BASIS prose does, so it is re-punctuated here. */
const EM_DASH = String.fromCharCode(0x2014);
export const withoutEmDash = (s: string) =>
  s
    .split(EM_DASH)
    .map((part) => part.trim())
    .join(": ");

function repoReading(c: RateCounts | null): RepoIntegrityReading {
  if (!c) return { state: "not-persisted", percent: null, count: null, population: null };
  if (c.population < REVIEW_INTEGRITY_MIN_SAMPLE) return { state: "below-floor", percent: null, ...c };
  return { state: "measured", percent: Math.round((c.count / c.population) * 100), ...c };
}

function fleetReading(rows: readonly PrRepoRow[], id: IntegrityRateId): FleetIntegrityReading {
  const carried = rows.filter((r) => counts(r, id) != null);
  const pool = poolFleetRate(
    id,
    carried.map((r) => ({ analyzed: r.analyzed, percent: null, counts: counts(r, id) })),
  );
  const count = pool.count ?? 0;
  const population = pool.population ?? 0;
  const legacyRepos = rows.length - carried.length;
  const under = carried.length > 0 && pool.percent == null ? `, below the ${REVIEW_INTEGRITY_MIN_SAMPLE}-PR floor, so no percentage is published` : "";
  return {
    id,
    percent: carried.length ? pool.percent : null,
    count,
    population,
    repos: pool.repos,
    legacyRepos,
    basis: carried.length ? `${count} of ${population} ${POPULATION_WORDS[id]}${under}` : "not measured in these scans",
    legacyNote: legacyRepos ? `${repoWord(legacyRepos)} predate${legacyRepos === 1 ? "s" : ""} these counts` : null,
    caveat: withoutEmDash(RATE_BASIS[id].caveat ?? ""),
  };
}

/**
 * Repos where approval mostly lands within minutes: at least REVIEW_INTEGRITY_MIN_SAMPLE approved PRs
 * and a fast share of FAST_APPROVAL_QUESTION_SHARE or more (compared on the exact ratio, so 49.5% is
 * not rounded into the list). Highest share first, then the larger sample, then name.
 */
export function integrityQuestions(rows: readonly PrRepoRow[]): IntegrityQuestion[] {
  const out: (IntegrityQuestion & { ratio: number })[] = [];
  for (const r of rows) {
    const c = counts(r, "fastApproval");
    if (!c || c.population < REVIEW_INTEGRITY_MIN_SAMPLE) continue;
    const ratio = c.count / c.population;
    if (ratio * 100 < FAST_APPROVAL_QUESTION_SHARE) continue;
    out.push({
      name: r.name,
      fullName: r.fullName,
      count: c.count,
      population: c.population,
      percent: Math.round(ratio * 100),
      ratio,
      sentence: `${r.name}: ${c.count} of ${c.population} approvals landed within ${FAST_APPROVAL_MAX_MINUTES} minutes of opening`,
    });
  }
  out.sort((a, b) => b.ratio - a.ratio || b.population - a.population || a.name.localeCompare(b.name));
  return out.map(({ ratio: _ratio, ...q }) => (void _ratio, q));
}

/** The Fix-first evidence for a question list: the first two repos named, the rest counted. */
export function integrityQuestionEvidence(questions: readonly IntegrityQuestion[]): string {
  if (questions.length === 1) return questions[0]!.sentence;
  const named = questions.slice(0, 2).map((q) => `${q.name}: ${q.count} of ${q.population}`);
  const rest = questions.length - named.length;
  return `${named.join(" and ")} approvals landed within ${FAST_APPROVAL_MAX_MINUTES} minutes of opening${
    rest > 0 ? `, plus ${rest} more repo${rest === 1 ? "" : "s"}` : ""
  }`;
}

export function reviewIntegrityModel(rows: readonly PrRepoRow[]): ReviewIntegrityModel {
  const anyCarried = rows.some((r) => INTEGRITY_RATE_IDS.some((id) => counts(r, id) != null));
  return {
    fleet: anyCarried ? { selfApproved: fleetReading(rows, "selfApproved"), fastApproval: fleetReading(rows, "fastApproval") } : null,
    repos: rows.map((r) => ({
      name: r.name,
      fullName: r.fullName,
      selfApproved: repoReading(counts(r, "selfApproved")),
      fastApproval: repoReading(counts(r, "fastApproval")),
    })),
    questions: integrityQuestions(rows),
  };
}
