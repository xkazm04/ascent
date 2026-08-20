// READ intelligence for Shared Org Memory — the `recall` verb (design doc §8 "Memory lifecycle").
//
// THE PROBLEM IT SOLVES: an agent asking "what does this org know?" has a CONTEXT BUDGET, not an
// appetite for 200 rows. Ordering by updatedAt hands it the most recently *edited* memory, which is not
// the same as the most VALUABLE one; ordering by confidence hands it a year-old certainty. So recall
// scores every eligible memory on three axes and packs the winners into a character budget:
//
//   score = confidence × 0.5^(ageDays / halfLife(kind)) × min(MAX_DELIVERY_BONUS, 1 + 0.25·ln(1 + accessCount))
//           └ trust ──┘  └──── exponential decay ─────┘  └──── times DELIVERED, capped ──────────────┘
//
// The decay is per-KIND because kinds age at wildly different rates: what happened last sprint
// (episodic) is stale in a month, a runbook step (procedural) is good for a year. Half-lives, not a
// hard cutoff, so nothing ever falls off a cliff — an old memory that keeps being delivered gets a
// bounded stay of execution via the accessCount term, which is sub-linear (ln) AND capped so a hot
// memory can neither dominate the ranking nor keep itself alive forever.
//
// WHAT THE THIRD TERM ACTUALLY MEASURES — read this before tuning it. `accessCount` counts DELIVERIES:
// times this memory was packed into a recall result and handed to an agent. It does NOT measure whether
// the agent read it, used it, or was helped by it. A memory injected into fifty prompts and ignored in
// all fifty scores exactly like one that answered the question fifty times.
//
// That gap is not a bug we are hiding — it is the honest limit of the evidence available at the call
// site, and it is stated here so nobody reads this term as "usefulness". The delivering adapter learns
// nothing about the agent's subsequent reasoning; there is no citation, no acceptance, no outcome
// flowing back. The two ways to close it would be (a) a distinct, evidence-bearing counter fed only by
// an act that PROVES use — the "Copy" click behind POST /api/org/memory/:id/recall is one such act, a
// tool-call citation would be another — which needs a schema column this module cannot add, or (b) an
// LLM judging usefulness after the fact, which would be a fabricated signal dressed as a measurement.
// Neither is done here. What IS done: the term is named for what it measures, its influence is bounded
// (MAX_DELIVERY_BONUS), and the "delivered" contract it depends on is expressed as an API the adapter
// must call rather than a sentence the adapter must remember (see `deliveredMemoryIds`).
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

/** Weight of the (sub-linear) DELIVERY bonus. 0.25·ln(1+n): 10 deliveries ≈ +60%, 100 ≈ +115%. */
export const ACCESS_BONUS_WEIGHT = 0.25;

/**
 * Ceiling on that bonus: being delivered may at most DOUBLE a memory's value, never more. Reached at
 * 1 + 0.25·ln(1+n) = 2, i.e. n = e⁴ − 1 ≈ 54 deliveries.
 *
 * It replaces no ceiling at all, and the uncapped version was the real defect. `accessCount` counts
 * deliveries, not uses (see the header), and delivery is something a memory earns simply by ranking
 * well — so the term fed its own input: rank high → get delivered → rank higher. Two consequences,
 * both observed in the value model rather than hypothetical:
 *
 *  1. RANKING. A memory that has been shipped into a thousand prompts and helped with none of them
 *     carried a 2.7× multiplier over a newly written, precisely relevant one. The ranking drifted from
 *     "what is worth this agent's context" toward "what this store has been in the habit of sending".
 *  2. FORGETTING. decay.ts scores with this same function and archives below DECAY_SCORE_FLOOR, so an
 *     unbounded bonus made repeated retrieval an unbounded stay of execution: a stale, low-confidence
 *     memory could hold itself above the floor by being retrieved and ignored, and the retrievals were
 *     free. With the cap, the arithmetic terminates — a confidence-0.3 memory needs its decay factor
 *     to fall below 0.15/(0.3·2) = 0.25, i.e. two half-lives, and then it is archived no matter how
 *     often it has been delivered. Delivery buys a bounded reprieve; it is no longer a veto.
 *
 * 2.0 rather than a tighter cap because the bonus must still be able to outrank an ordinary confidence
 * gap (0.5 vs 0.9) between two memories of the same age — that discrimination is the reason the term
 * exists. The trade-off accepted: past ~54 deliveries the term stops discriminating at all, so two
 * heavily delivered memories are separated by confidence and age alone. That is the intended
 * behaviour, not a rounding artefact — beyond that point the delivery count is measuring the store's
 * own habits, and we would rather rank on the two axes that mean something.
 */
export const MAX_DELIVERY_BONUS = 2;

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
  // DELIVERY, not usefulness — and capped, so a memory can never keep itself alive (or at the top)
  // purely by having been retrieved often. See MAX_DELIVERY_BONUS.
  const delivery = Math.min(
    MAX_DELIVERY_BONUS,
    1 + ACCESS_BONUS_WEIGHT * Math.log(1 + Math.max(0, m.accessCount)),
  );
  const confidence = Math.min(1, Math.max(0, m.confidence));
  return Number((confidence * decay * delivery).toFixed(4));
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
 * The caller's remaining duty — bumping accessCount for what was delivered — has an API rather than a
 * sentence: `deliveredMemoryIds` below. Do not derive that set by hand.
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

/**
 * The ids a caller may count as DELIVERED — the only supported input to an accessCount bump.
 *
 * This is a one-liner with a doc comment on purpose. The rule it encodes ("only what was packed
 * reaches the agent, so only what was packed may be counted") used to live as a NOTE on
 * `recallMemories`, and a note is not a contract: every adapter — the REST route today, an MCP
 * `memory_recall` verb tomorrow — re-derived the set by hand from a `RecallResult` that also carries
 * `omitted`, a field one plausible slip away (`[...selected, ...omitted]`) from turning accessCount
 * into "how many times was this store queried". That number rises for every memory at once and
 * therefore ranks nothing, while also feeding decay.ts's forget floor for rows nobody ever saw.
 *
 * It does NOT — and cannot, from here — assert that a delivered memory was USED. Delivery is the
 * strongest evidence this layer has; see the header for why we don't manufacture more.
 */
export function deliveredMemoryIds(result: RecallResult): string[] {
  return result.selected.map((s) => s.memory.id);
}
