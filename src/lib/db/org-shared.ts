// Shared internals for the org-rollup family (org-*.ts). Private to the db layer — re-exported
// through org.ts only where part of the public surface; the helpers here are not. All guarded by
// DATABASE_URL at the call sites.

export const LEVEL_RANK: Record<string, number> = { L1: 1, L2: 2, L3: 3, L4: 4, L5: 5 };
export const IMPACT_WEIGHT: Record<string, number> = { high: 3, medium: 2, low: 1 };

/**
 * Repo-level where-fragment that scopes an aggregate to a custom segment (a user-defined tag on
 * repos — see src/lib/db/segments.ts). Empty when no segment is selected, so every aggregate stays
 * fleet-wide by default. AND-combines with the existing `orgId` filter, so a segment id from another
 * org matches no repos rather than leaking across tenants.
 */
export function segmentScope(segmentId?: string | null) {
  return segmentId ? { segments: { some: { segmentId } } } : {};
}

/**
 * Repo-level where-fragment that scopes an aggregate to an auto-derived tech-stack group (Feature 3b —
 * frontend / backend:<lang> / mobile / …). Empty when no group is selected (fleet-wide default).
 * AND-combines with `orgId` and composes with segmentScope (segment AND stack). Keyed on the group's
 * globally-unique id (the page resolves the `?stack=` key → id against the org's own groups), so a group
 * id from another org matches no repos rather than leaking across tenants — exactly like segmentScope.
 */
export function techGroupScope(groupId?: string | null) {
  return groupId ? { techGroups: { some: { groupId } } } : {};
}

// All derived from the stored RepoContributor snapshots (latest scan per repo) — no extra
// GitHub calls. "commits"/"aiCommits" reflect the recent-activity window we capture at scan
// time. Bots ([bot]) and unattributed ("unknown") commits are excluded from the human view.
export const isBot = (login: string) => /\[bot\]$/i.test(login) || login === "unknown";

/** Arithmetic mean of a number list; 0 for an empty list (never divides by zero). */
export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** {@link mean}, rounded to the nearest integer. The canonical rounded-average for the org rollups
 *  — always empty-guarded, so copies that omitted the guard are corrected by routing through here. */
export function roundedMean(xs: number[]): number {
  return Math.round(mean(xs));
}

/**
 * Streaming grouped-mean accumulator: feed `(key, value)` pairs, read back each key's ROUNDED mean.
 * Single-sources the `{ sum, n }`-per-key → `Math.round(sum / n)` idiom the rollups hand-rolled for
 * per-dimension / per-day / per-team averages (where {@link roundedMean} only covers the materialized-
 * array case). Backed by a Map, so `keys()`/`entries()` come back in first-seen insertion order —
 * callers that need a stable order sort explicitly, exactly as the inlined versions did.
 */
export class GroupedMean {
  private readonly acc = new Map<string, { sum: number; n: number }>();

  /** Add one sample to a key's running total. */
  add(key: string, value: number): void {
    const e = this.acc.get(key);
    if (e) {
      e.sum += value;
      e.n += 1;
    } else {
      this.acc.set(key, { sum: value, n: 1 });
    }
  }

  /** Rounded mean for a key (`Math.round(sum / n)`); 0 when the key was never added. */
  get(key: string): number {
    const e = this.acc.get(key);
    return e ? Math.round(e.sum / e.n) : 0;
  }

  /** Keys in first-seen insertion order. */
  keys(): string[] {
    return [...this.acc.keys()];
  }

  /** `[key, roundedMean]` pairs in first-seen insertion order. */
  entries(): [string, number][] {
    return [...this.acc.entries()].map(([k, e]) => [k, Math.round(e.sum / e.n)] as [string, number]);
  }
}

/**
 * Optional date-range where-fragment for a Prisma date column. Returns `{}` when neither bound is
 * given (the query stays unbounded), else `{ [field]: { gte?, lte? } }` carrying only the bounds that
 * are present. Single-sources the windowed `{ ...(start ? { gte } : {}), ...(end ? { lte } : {}) }`
 * spread the rollup queries hand-rolled per call site; `field` selects the column (`scannedAt` by
 * default, `createdAt` for the recommendation-event query). Spread the result into a `where` object.
 */
export function dateRange<F extends string = "scannedAt">(
  start?: Date | null,
  end?: Date | null,
  field: F = "scannedAt" as F,
): { [K in F]?: { gte?: Date; lte?: Date } } {
  const out: { [K in F]?: { gte?: Date; lte?: Date } } = {};
  if (!start && !end) return out;
  const range: { gte?: Date; lte?: Date } = {};
  if (start) range.gte = start;
  if (end) range.lte = end;
  out[field] = range;
  return out;
}

/** Share (0..100) of a person's commits that are AI-attributed; 0 when they have no commits.
 *  Single source for the "AI champion" share formula used by both contributor and team rollups. */
export function aiShareOf(commits: number, aiCommits: number): number {
  return commits ? Math.round((aiCommits / commits) * 100) : 0;
}

/**
 * Select the top-N "champions" from a human-only contributor list: keep those passing `filter`, sort by
 * the `by` metric descending, and take the first `limit`. The shared select-shape behind both
 * `getContributorInsights` (ranked by championScore, sliced 6, requires ≥3 commits) and `rollupTeams`
 * (ranked by aiCommits, sliced 3); each caller supplies its own filter/metric/limit. Does not mutate
 * the input (sorts a copy).
 */
export function pickChampions<T>(people: T[], opts: { filter: (p: T) => boolean; by: (p: T) => number; limit: number }): T[] {
  return people
    .filter(opts.filter)
    .sort((a, b) => opts.by(b) - opts.by(a))
    .slice(0, opts.limit);
}
