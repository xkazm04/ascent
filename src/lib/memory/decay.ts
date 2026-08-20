// The `forget` verb for Shared Org Memory (design doc §8 "Memory lifecycle → prune"). Archive-by-decay:
// the store's own janitor.
//
// THE PROBLEM IT SOLVES: recall's budget is finite, so every low-value memory that survives forever is a
// tax on every future recall. But "forgetting" in a shared, audited org store cannot mean DELETING —
// somebody wrote that row, an audit may need it, and a wrong prune is unrecoverable. So forget = set
// `archived = true`: the row leaves every default read and every recall, and stays in the table.
//
// FOUR CONDITIONS, ALL REQUIRED. Any one alone would be wrong, and the conjunction is what makes this
// safe enough to run unattended:
//   1. decayed score < 0.15   — the same value model recall ranks by, so forgetting and remembering can
//                               never disagree about what a memory is worth.
//   2. age > 60 days          — nothing recent is ever archived, whatever its score. A hunch typed this
//                               morning (confidence 0.3) must survive long enough to be confirmed.
//   3. confidence ≤ 0.3       — only the "low" band (see CONFIDENCE_BANDS). A verified fact is never
//                               archived by age alone; old and TRUE is the normal state of a semantic
//                               memory, and letting decay touch it would quietly erase the org's history.
//   4. kind ≠ procedural      — runbooks are the longest-lived thing in the store and the most expensive
//                               to lose. They are exempt from automatic forgetting, full stop.
//
// Note what conditions 1+3 imply together: an old, low-confidence memory that is still being DELIVERED
// keeps a score above the floor via the value model's delivery term, and survives a while longer.
//
// That reprieve is BOUNDED, and the bound is the point. `accessCount` counts times a memory was packed
// into a recall result — deliveries, not proven uses (recall.ts's header says so plainly). A memory that
// is injected into every prompt and helped with none of them accrues the identical signal, and it accrues
// it for free. While the delivery term was uncapped, that made retrieval a permanent veto on forgetting:
// the store could keep its own worst rows alive by continuing to send them. recall.ts now caps the term
// at MAX_DELIVERY_BONUS (2×), so the arithmetic terminates — a confidence-0.3 memory falls under
// DECAY_SCORE_FLOOR once its decay factor drops below 0.15/(0.3·2) = 0.25, i.e. after two half-lives,
// however many times it has been delivered. Delivery buys a stay of execution, never an exemption; the
// three real exemptions are the ones listed above, and each is a deliberate policy.
//
// Pure and framework-agnostic like recall.ts/reflection.ts: `now` is injected, and the actual write is
// an injected archiver so the policy can be unit-tested without a database.

import { isRecallable, memoryValue, type RecallCandidate } from "@/lib/memory/recall";

/** Below this decayed score a memory is no longer paying for the recall budget it occupies. */
export const DECAY_SCORE_FLOOR = 0.15;
/** Nothing younger than this is ever archived, whatever it scores — the grace period for new writes. */
export const DECAY_MIN_AGE_DAYS = 60;
/** Only the "low" confidence band (CONFIDENCE_BANDS: low = 0.3) is eligible. */
export const DECAY_MAX_CONFIDENCE = 0.3;
/** Kinds automatic forgetting may never touch. Procedural memory is the store's crown jewels. */
export const DECAY_EXEMPT_KINDS: readonly string[] = ["procedural"];
/** Safety valve: one pass never archives more than this, so a bad policy edit can't empty a store in
 *  one call. The remainder is picked up by the next pass — and a human sees the count in between. */
export const DECAY_MAX_PER_PASS = 50;

const MS_PER_DAY = 86_400_000;

export interface DecayVerdict {
  id: string;
  score: number;
  ageDays: number;
  /** True when all four conditions hold. */
  archive: boolean;
  /** The first condition that SPARED the memory — "" when it is being archived. For the audit line. */
  sparedBy: string;
}

/** Evaluate one memory against the forget policy. Pure; `nowMs` injected. */
export function decayVerdict(m: RecallCandidate, nowMs: number): DecayVerdict {
  const t = Date.parse(m.updatedAt);
  const ageDays = Number.isFinite(t) ? Math.max(0, (nowMs - t) / MS_PER_DAY) : 0;
  const score = memoryValue(m, nowMs);
  const base = { id: m.id, score, ageDays: Number(ageDays.toFixed(2)) };

  // Order matters only for the explanation, not the outcome: all four must hold to archive.
  if (DECAY_EXEMPT_KINDS.includes(m.kind)) return { ...base, archive: false, sparedBy: "kind" };
  if (m.confidence > DECAY_MAX_CONFIDENCE) return { ...base, archive: false, sparedBy: "confidence" };
  if (ageDays <= DECAY_MIN_AGE_DAYS) return { ...base, archive: false, sparedBy: "age" };
  if (score >= DECAY_SCORE_FLOOR) return { ...base, archive: false, sparedBy: "score" };
  return { ...base, archive: true, sparedBy: "" };
}

/**
 * The archive set for one pass: only ACTIVE rows (an already-archived, superseded or expired memory has
 * nothing left to forget), lowest score first so the weakest go first when the cap bites.
 */
export function selectDecayed(items: RecallCandidate[], nowMs: number): DecayVerdict[] {
  return items
    .filter((m) => isRecallable(m, nowMs))
    .map((m) => decayVerdict(m, nowMs))
    .filter((v) => v.archive)
    .sort((a, b) => a.score - b.score || a.id.localeCompare(b.id))
    .slice(0, DECAY_MAX_PER_PASS);
}

/** Injected by the adapter: archives the given ids (scoped to the caller's org) and reports how many
 *  rows it actually touched. Never a delete. */
export type ArchiveFn = (ids: string[]) => Promise<number>;

export interface DecayReport {
  /** The ids this pass archived (or would have — see `dryRun`). */
  archivedIds: string[];
  /** Rows the archiver actually updated. Can be < archivedIds.length if a row moved under us. */
  archivedCount: number;
  /** How many active rows were evaluated. */
  evaluated: number;
  dryRun: boolean;
}

/**
 * Run one forget pass. Pure policy + one injected write, so the whole verb is testable without Prisma.
 * `dryRun` returns exactly what WOULD be archived without touching anything — the honest default for a
 * UI that wants to show a human the list before it happens.
 */
export async function archiveDecayed(
  items: RecallCandidate[],
  nowMs: number,
  archive: ArchiveFn,
  opts: { dryRun?: boolean } = {},
): Promise<DecayReport> {
  const evaluated = items.filter((m) => isRecallable(m, nowMs)).length;
  const archivedIds = selectDecayed(items, nowMs).map((v) => v.id);
  if (opts.dryRun || archivedIds.length === 0) {
    return { archivedIds, archivedCount: 0, evaluated, dryRun: Boolean(opts.dryRun) };
  }
  const archivedCount = await archive(archivedIds);
  return { archivedIds, archivedCount, evaluated, dryRun: false };
}
