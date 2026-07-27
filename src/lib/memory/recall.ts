// READ intelligence for Shared Org Memory — the `recall` verb (design doc §8 "Memory lifecycle").
//
// THE PROBLEM IT SOLVES: an agent asking "what does this org know?" has a CONTEXT BUDGET, not an
// appetite for 200 rows. Ordering by updatedAt hands it the most recently *edited* memory, which is not
// the same as the most VALUABLE one; ordering by confidence hands it a year-old certainty. So recall
// scores every eligible memory on three axes and packs the winners into a character budget:
//
//   score = confidence × 0.5^(ageDays / halfLife(kind)) × (1 + 0.25·ln(1 + accessCount))
//           └ trust ──┘  └──── exponential decay ─────┘  └──── proven usefulness ─────┘
//
// The decay is per-KIND because kinds age at wildly different rates: what happened last sprint
// (episodic) is stale in a month, a runbook step (procedural) is good for a year. Half-lives, not a
// hard cutoff, so nothing ever falls off a cliff — an old memory that is still recalled weekly keeps
// earning its place via the accessCount term, which is sub-linear (ln) so a hot memory can't dominate.
//
// This module is FRAMEWORK-AGNOSTIC AND PURE, exactly like consolidation.ts: no Prisma, no Next, and —
// load-bearing for the tests — NO `Date.now()`. `now` is always injected, so a scoring assertion is a
// fixed number rather than a moving target.

/** The subset of a stored memory recall reasons over (structurally satisfied by db MemoryRow). */
export interface RecallCandidate {
  id: string;
  content: string;
  kind: string;
  /** 0..1 trust score. */
  confidence: number;
  /** ISO timestamp — the recency axis. Edits refresh it, which is intended: a corrected memory is fresh. */
  updatedAt: string;
  accessCount: number;
  namespace?: string;
  /** Set when a correction replaced this memory — such rows are never recallable. */
  supersededBy?: string | null;
  archived?: boolean;
  expiresAt?: string | null;
}

export interface ScoredMemory {
  memory: RecallCandidate;
  /** The value-model score at the injected `now`, rounded to 4dp so results are stable across hosts. */
  score: number;
  /** Days since updatedAt, rounded to 2dp — surfaced so a caller can explain the ranking. */
  ageDays: number;
}

export interface RecallResult {
  /** The packed selection, strongest first. Never truncated mid-content. */
  selected: ScoredMemory[];
  /** Scored but left out — either budget or eligibility. Strongest first. */
  omitted: ScoredMemory[];
  /** Sum of the selected items' content lengths (≤ charBudget). */
  usedChars: number;
  charBudget: number;
  /** How many rows were eligible before packing — so a caller never implies it saw everything. */
  consideredCount: number;
}

// ── Tunables ─────────────────────────────────────────────────────────────────────────────────

/**
 * Half-life in DAYS per kind: the age at which a memory's score halves, all else equal. These encode a
 * claim about how fast each kind of knowledge rots, and they are the main lever on recall behaviour:
 *   episodic   30 — "what happened" is context for weeks, not quarters.
 *   semantic  180 — a durable fact about the org; still, stacks change every couple of releases.
 *   procedural 365 — "what worked" is the longest-lived thing here (and decay never archives it).
 *   summary   120 — a rollup outlives its members but should yield to a newer rollup.
 */
export const KIND_HALF_LIFE_DAYS: Record<string, number> = {
  episodic: 30,
  semantic: 180,
  procedural: 365,
  summary: 120,
};

/** Fallback half-life for a legacy/unknown kind — the semantic default the schema itself uses. */
export const DEFAULT_HALF_LIFE_DAYS = 180;

/** Weight of the (sub-linear) usage bonus. 0.25·ln(1+n): 10 recalls ≈ +60%, 100 ≈ +115%. */
export const ACCESS_BONUS_WEIGHT = 0.25;

/** Default context budget in characters — roughly 1.5k tokens, a polite slice of any agent's window. */
export const DEFAULT_CHAR_BUDGET = 6000;

/** Guard rails for a caller-supplied budget: never 0 (useless), never unbounded (that's the list API). */
export const MIN_CHAR_BUDGET = 200;
export const MAX_CHAR_BUDGET = 60_000;

const MS_PER_DAY = 86_400_000;

// ── The value model (pure) ───────────────────────────────────────────────────────────────────

export function halfLifeDays(kind: string): number {
  return KIND_HALF_LIFE_DAYS[kind] ?? DEFAULT_HALF_LIFE_DAYS;
}

/** Days between `updatedAt` and `nowMs`. Clamped at 0 so clock skew (a future timestamp) can't BOOST a
 *  memory above its confidence ceiling, and an unparseable date is treated as brand new rather than
 *  NaN-poisoning the whole ranking. */
export function ageInDays(updatedAt: string, nowMs: number): number {
  const t = Date.parse(updatedAt);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, (nowMs - t) / MS_PER_DAY);
}

/**
 * The recall value of one memory at a given instant. Pure, deterministic, and injected-`now` only.
 * Rounded to 4dp: float noise must never reorder two otherwise-equal memories between two calls.
 */
export function memoryValue(m: RecallCandidate, nowMs: number): number {
  const age = ageInDays(m.updatedAt, nowMs);
  const decay = Math.pow(0.5, age / halfLifeDays(m.kind));
  const usage = 1 + ACCESS_BONUS_WEIGHT * Math.log(1 + Math.max(0, m.accessCount));
  const confidence = Math.min(1, Math.max(0, m.confidence));
  return Number((confidence * decay * usage).toFixed(4));
}

/**
 * Eligibility (mirrors the db-layer read policy so the pure core can be tested — and trusted — on its
 * own): a superseded memory was replaced by a correction, an archived one was retired, an expired one
 * hit its TTL. None of the three may ever reach an agent's context.
 */
export function isRecallable(m: RecallCandidate, nowMs: number): boolean {
  if (m.archived) return false;
  if (m.supersededBy) return false;
  if (m.expiresAt) {
    const exp = Date.parse(m.expiresAt);
    if (Number.isFinite(exp) && exp <= nowMs) return false;
  }
  return true;
}

/** Score every candidate and sort strongest-first. Ties break on id so the order is total + stable. */
export function scoreMemories(items: RecallCandidate[], nowMs: number): ScoredMemory[] {
  return items
    .map((memory) => ({
      memory,
      score: memoryValue(memory, nowMs),
      ageDays: Number(ageInDays(memory.updatedAt, nowMs).toFixed(2)),
    }))
    .sort((a, b) => b.score - a.score || a.memory.id.localeCompare(b.memory.id));
}

/**
 * Greedy WHOLE-ITEM packing by descending score. Two deliberate choices:
 *
 *  - An item is never truncated. Half a memory is worse than no memory: it reads as a complete fact to
 *    the model consuming it, and a clipped conditional ("…unless the repo is public") inverts meaning.
 *  - A too-large item is SKIPPED, not a stop condition. We keep scanning so a 300-char memory ranked #9
 *    still lands when the 8000-char memory ranked #3 could not. This is the classic greedy knapsack
 *    approximation — not optimal, but deterministic and explainable, which matters more here.
 */
export function packByBudget(scored: ScoredMemory[], charBudget: number): {
  selected: ScoredMemory[];
  omitted: ScoredMemory[];
  usedChars: number;
} {
  const selected: ScoredMemory[] = [];
  const omitted: ScoredMemory[] = [];
  let used = 0;
  for (const s of scored) {
    const cost = s.memory.content.length;
    if (used + cost <= charBudget) {
      selected.push(s);
      used += cost;
    } else {
      omitted.push(s);
    }
  }
  return { selected, omitted, usedChars: used };
}

export interface RecallOptions {
  /** Injected clock (ms since epoch). Required — the core never reads the wall clock itself. */
  now: number;
  charBudget?: number;
  /** Restrict to these kinds. Empty/undefined = all kinds. */
  kinds?: string[];
  /** Restrict to one namespace. `""`/undefined = no namespace filter (the db layer scopes the tenant). */
  namespace?: string;
}

export function normalizeCharBudget(v: unknown): number {
  if (v === null || v === undefined || v === "") return DEFAULT_CHAR_BUDGET;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return DEFAULT_CHAR_BUDGET;
  return Math.min(MAX_CHAR_BUDGET, Math.max(MIN_CHAR_BUDGET, Math.floor(n)));
}

/**
 * The recall entry point every adapter (REST route today, MCP `memory_recall` tomorrow) calls: filter →
 * score → pack. Pure and total — an empty store yields an empty, well-formed result, never a throw.
 *
 * NOTE the caller's remaining duty: only the memories in `selected` may have their accessCount bumped.
 * "Recalled" means "actually reached the agent", otherwise the usage term in the value model degenerates
 * into a count of how often the store was queried, and every memory drifts upward together.
 */
export function recallMemories(items: RecallCandidate[], opts: RecallOptions): RecallResult {
  const charBudget = normalizeCharBudget(opts.charBudget);
  const kinds = opts.kinds?.length ? new Set(opts.kinds) : null;
  const ns = opts.namespace?.trim();

  const eligible = items.filter(
    (m) =>
      isRecallable(m, opts.now) &&
      (!kinds || kinds.has(m.kind)) &&
      (!ns || (m.namespace ?? "") === ns),
  );

  const scored = scoreMemories(eligible, opts.now);
  const { selected, omitted, usedChars } = packByBudget(scored, charBudget);
  return { selected, omitted, usedChars, charBudget, consideredCount: eligible.length };
}
