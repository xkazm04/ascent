// THE CYCLE — one unattended pass over one organization.
//
// This is the same split turn.ts makes, for the same reason: a cycle is NOT a route. Everything that
// decides whether she speaks, what she spends and what she remembers lives here, behind injected
// dependencies, so a whole cycle runs against fakes in a plain node test with no database, no network
// and no Next.js. `src/app/api/cron/athena/route.ts` is the hosting shell — auth, the at-most-once
// claim, the fan-out and the status code — and carries no cycle logic.
//
// ── FOUR RULES, AND THEY ARE ORDERED ───────────────────────────────────────────────────────────
//
// 1. A COMPLETION IS NEVER SPENT WHEN THERE IS NOWHERE TO LAND IT. The landing is resolved FIRST,
//    before the prompt is built and long before a model is called. An org with no reachable thread
//    and no way to mint one is skipped with no spend at all. (`no_landing`)
//
// 2. A CYCLE NEVER RUNS CONCURRENTLY WITH A LIVE TURN, AND NEVER QUEUES BEHIND ONE. An operator
//    mid-conversation is the one moment an unattended pass is most likely to interrupt with something
//    stale, and a queued cycle would land its briefing into the middle of an exchange minutes later.
//    So the org is SKIPPED (`live_turn`) and the next tick picks it up.
//
// 3. REPORT-OR-ABSORB DECIDES CONTACT, NOT THE MODEL. The completion is judged outcome by outcome by
//    `cycle-signal.ts`. A run where nothing clears the bar lands NOTHING — no message, no proposals,
//    no "all quiet" note — and is still fully recorded.
//
// 4. SHE WRITES EXACTLY ONE EPISODE, AND IT IS HERS. Never a user episode: her recall reads this store
//    back, and a user episode written by an unattended job would put words in the operator's mouth in
//    the one place she trusts as a record of what they said.
//
// ── WHAT IT MAY NEVER DO ───────────────────────────────────────────────────────────────────────
//
// NO PATH HERE WRITES `AthenaIdentity`. There is no identity writer in {@link OrgCycleDeps} and there
// must never be one: an unattended pass that could edit her constitution or self-model is a companion
// who rewrites who she is while nobody is looking. `src/lib/db/athena-identity.ts` exposes no writer
// for the constitution at all, and `cycle.test.ts` asserts at the SOURCE level that no module in this
// cycle imports the self-model writer either.

import { parseAthenaActions, athenaActionPayload, athenaActionSummary } from "@/lib/athena/actions";
import { parseAthenaBlocks } from "@/lib/athena/blocks";
import { buildCycleBriefingPrompt, isCycleSilence, type CycleOpenProposal, type CycleStanding } from "@/lib/athena/cycle-prompt";
import {
  composeCycleMessage,
  partitionCycleOutcomes,
  summarizeCycle,
  absorbedTally,
  type AbsorbedTally,
  type CycleOutcome,
} from "@/lib/athena/cycle-signal";
import { deriveThreadTitle } from "@/lib/db/athena-threads";
import type { AthenaLoopRun } from "@/lib/athena/turn";
import { ATHENA_TOTAL_BUDGET_MS } from "@/lib/llm/tool-loop";

// ── the hosting constants a cron shell needs ────────────────────────────────────────────────────

/**
 * COUPLED CONSTANT. `maxDuration` in `src/app/api/cron/athena/route.ts` MUST equal this — Next.js
 * requires that segment config to be a statically-analyzable literal, so the route cannot import it,
 * and `route.test.ts` pins the equality instead. Same idiom as `PURGE_MAX_DURATION_S`
 * (`src/lib/db/retention.ts:40-52`).
 */
export const ATHENA_CYCLE_MAX_DURATION_S = 300;

/**
 * Lanes in the fan-out. Deliberately lower than `SCAN_CONCURRENCY` (4): every lane here holds a model
 * completion open for up to {@link ATHENA_TOTAL_BUDGET_MS}, and this is unattended spend against a
 * provider that other, INTERACTIVE surfaces are sharing at the same moment.
 */
export const ATHENA_CYCLE_CONCURRENCY = 2;

/**
 * How long one org's briefing may take. Well under the loop's own 90s ceiling would starve a slow
 * provider; the loop budget IS the per-org ceiling, and the deadline pool is what stops new lanes.
 */
export const ATHENA_CYCLE_BUDGET_MS = ATHENA_TOTAL_BUDGET_MS;

/** The audit action the at-most-once claim is taken under. */
export const ATHENA_CYCLE_ACTION = "athena_cycle.ran";

/**
 * The coalescing window. A second invocation inside it (a platform retry, a re-fired schedule, a
 * manual poke) finds the claim and does nothing. 20 hours rather than 24 so a daily schedule that
 * drifts a few minutes earlier still claims its own day.
 */
export const ATHENA_CYCLE_PERIOD_MS = 20 * 60 * 60 * 1000;

/** The period as she is told about it in the prompt. */
export const ATHENA_CYCLE_PERIOD_LABEL = "the last day";

/**
 * How recent a trailing USER turn must be to count as a turn still in flight.
 *
 * A live turn persists the operator's question BEFORE the model is called (turn.ts) and its answer
 * after, so "the newest turn in the org's newest thread is a user turn, written moments ago" is
 * exactly the shape of an exchange in progress. The window is the loop's own total budget plus
 * headroom: past that the turn cannot still be running, and an unanswered question is a turn that
 * FAILED — which the cycle must not treat as a permanent do-not-disturb sign.
 */
export const ATHENA_LIVE_TURN_WINDOW_MS = ATHENA_TOTAL_BUDGET_MS + 30_000;

// ── the injected world ──────────────────────────────────────────────────────────────────────────

/** Where a briefing would land, and whether someone is mid-conversation there. */
export interface CycleLanding {
  /** The org's most recently active thread, or null when she has never had one here. */
  threadId: string | null;
  /** Role of the newest turn in that thread. Null when the thread has no turns. */
  lastRole: "user" | "assistant" | null;
  /** ISO timestamp of that turn. Null when there is none. */
  lastAt: string | null;
}

export interface CycleLandInput {
  /** null = mint a thread. The title is derived from the briefing — never typed. */
  threadId: string | null;
  title: string;
  content: string;
  meta: Record<string, unknown>;
  inputTokens: number | null;
  outputTokens: number | null;
  legs: number | null;
  proposals: { kind: string; payload: Record<string, unknown> }[];
}

export interface OrgCycleDeps {
  /** Null = there is no landing and none can be made. Resolved BEFORE any spend — see rule 1. */
  landing: () => Promise<CycleLanding | null>;
  /** Null = no standing to brief on. Also resolved before any spend. */
  standing: () => Promise<CycleStanding | null>;
  openProposals: () => Promise<CycleOpenProposal[]>;
  identity: () => Promise<{ constitution: string | null; selfModel: string | null }>;
  /** Null means NO ENGINE — a first-class outcome, exactly as in the interactive turn. */
  runLoop: (req: { prompt: string; signal?: AbortSignal }) => Promise<AthenaLoopRun | null>;
  /** Writes the turn AND its proposals in one transaction. Null when nothing could be written. */
  land: (input: CycleLandInput) => Promise<{ threadId: string; turnId: string } | null>;
  /** Never throws by contract (athena-episodes.ts). */
  writeEpisode: (input: { content: string; tags: string[]; confidence?: number }) => Promise<unknown>;
  now?: () => Date;
}

export type CycleSkipReason = "no_landing" | "live_turn" | "no_standing" | "no_engine";

export interface OrgCycleResult {
  org: string;
  /** Non-null means NO model call was made (or none produced an outcome) — see {@link claimHeld}. */
  skipped: CycleSkipReason | null;
  /** True when a message was actually written into a thread. */
  landed: boolean;
  threadId: string | null;
  raised: number;
  absorbed: number;
  absorbedBy: AbsorbedTally;
  /** Proposals written with the landed turn. */
  proposals: number;
  /**
   * Whether the at-most-once claim for this period should be KEPT. False on every skip and on a
   * failure: a window marked done by a run that did no work would silence the org until tomorrow.
   */
  claimHeld: boolean;
  error?: string;
}

/** Pure: is this org mid-exchange right now? Exported so the rule is testable without a database. */
export function isLiveTurn(landing: CycleLanding, now: Date): boolean {
  if (landing.lastRole !== "user" || !landing.lastAt) return false;
  const at = Date.parse(landing.lastAt);
  if (!Number.isFinite(at)) return false;
  const age = now.getTime() - at;
  return age >= 0 && age <= ATHENA_LIVE_TURN_WINDOW_MS;
}

const skip = (org: string, reason: CycleSkipReason): OrgCycleResult => ({
  org,
  skipped: reason,
  landed: false,
  threadId: null,
  raised: 0,
  absorbed: 0,
  absorbedBy: {},
  proposals: 0,
  claimHeld: false,
});

export interface OrgCycleInput {
  orgSlug: string;
  signal?: AbortSignal;
  deps: OrgCycleDeps;
}

/**
 * Run one org's cycle.
 *
 * The order of the first three steps is the safety argument, not an optimization: landing, then
 * in-flight, then standing — every one of them cheap, every one of them able to end the run BEFORE a
 * billable completion exists. Only after all three pass is a prompt built.
 */
export async function runOrgCycle(input: OrgCycleInput): Promise<OrgCycleResult> {
  const { deps, orgSlug } = input;
  const now = deps.now ?? (() => new Date());

  // 1. Where would it land? (No spend past this point without an answer.)
  const landing = await deps.landing();
  if (!landing) return skip(orgSlug, "no_landing");

  // 2. Is someone mid-conversation? Skip, never queue.
  if (isLiveTurn(landing, now())) return skip(orgSlug, "live_turn");

  // 3. Is there anything to brief on?
  const standing = await deps.standing();
  if (!standing) return skip(orgSlug, "no_standing");

  const [identity, openProposals] = await Promise.all([
    deps.identity().catch(() => ({ constitution: null, selfModel: null })),
    deps.openProposals().catch(() => [] as CycleOpenProposal[]),
  ]);

  const prompt = buildCycleBriefingPrompt({
    orgSlug,
    constitution: identity.constitution,
    selfModel: identity.selfModel,
    standing,
    openProposals,
    periodLabel: ATHENA_CYCLE_PERIOD_LABEL,
  });

  const loop = await deps.runLoop({ prompt, signal: input.signal });
  // No engine: nothing was spent, nothing is remembered. The interactive turn answers one quiet line
  // because a human is waiting for it; nobody is waiting for this, so there is nothing to say it to.
  if (!loop) return skip(orgSlug, "no_engine");

  // ORDER IS LOAD-BEARING, exactly as in turn.ts: actions come out FIRST (blocks.ts does not consume
  // the action fence, so one left in place would reach the operator as raw JSON), then blocks.
  const acts = parseAthenaActions(loop.text);
  const parsed = parseAthenaBlocks(acts.text);

  // Her declared silence. Checked AFTER the fences are stripped so a stray block cannot hide it, and
  // it discards any offer attached to it: an action proposed alongside "nothing to report" is not an
  // offer she made, it is a reflex, and an unanswerable card is the exact noise this gate exists for.
  const silent = isCycleSilence(parsed.prose);
  const prose = silent ? "" : parsed.prose.trim();
  const actions = silent ? [] : acts.actions;

  // ── report-or-absorb, per outcome, on its own terms ─────────────────────────────────────────
  const outcomes: CycleOutcome[] = [
    {
      id: "briefing",
      kind: "briefing",
      text: prose,
      // The standing is already on the dashboard: her saying it again is not news unless it MOVED.
      delta: standing.overallDelta,
      alreadyVisible: true,
    },
    ...actions.map<CycleOutcome>((a) => ({
      id: `action:${a.id}`,
      kind: "proposal",
      text: athenaActionSummary(a.id, a.params) ?? a.id,
      decision: a.id,
    })),
  ];

  const part = partitionCycleOutcomes(outcomes);
  const message = composeCycleMessage(part.raised);
  const raisedActionIds = new Set(part.raised.filter((o) => o.kind === "proposal").map((o) => o.id));
  const proposals = actions
    .filter((a) => raisedActionIds.has(`action:${a.id}`))
    .map((a) => ({ kind: a.id as string, payload: athenaActionPayload(a) }));

  const episode = summarizeCycle(part, message !== null);
  const tally = absorbedTally(part.absorbed);

  // Absorbed in full: recorded, counted, and it initiates nothing. The claim is still HELD — the work
  // was done and the period is genuinely finished; a released claim would re-run the same quiet day.
  if (message === null) {
    await deps.writeEpisode({ content: episode, tags: ["athena", "cycle", "absorbed"], confidence: 0.5 });
    return {
      org: orgSlug,
      skipped: null,
      landed: false,
      threadId: landing.threadId,
      raised: 0,
      absorbed: part.absorbed.length,
      absorbedBy: tally,
      proposals: 0,
      claimHeld: true,
    };
  }

  const landed = await deps.land({
    threadId: landing.threadId,
    // Derived from the briefing's own first line — never typed, the same rule the interactive thread
    // titles itself by. Only used when a thread is minted; an existing thread keeps its title.
    title: deriveThreadTitle(message),
    content: message,
    meta: {
      cycle: true,
      blocks: parsed.blocks,
      grounding: loop.grounding,
      truncated: loop.truncated,
      engine: loop.engine,
      model: loop.model,
      droppedBlocks: parsed.dropped,
      truncatedBlocks: parsed.truncated,
      overflowBlocks: parsed.overflow,
      droppedActions: acts.dropped,
      overflowActions: acts.overflow,
      // Counted here rather than said in the message: inspectable on demand, never contact.
      absorbed: tally,
      raised: part.raised.length,
    },
    inputTokens: loop.usage.inputTokens ?? null,
    outputTokens: loop.usage.outputTokens ?? null,
    legs: loop.legs,
    proposals,
  });

  await deps.writeEpisode({ content: episode, tags: ["athena", "cycle"], confidence: 0.5 });

  return {
    org: orgSlug,
    skipped: null,
    landed: landed !== null,
    threadId: landed?.threadId ?? landing.threadId,
    raised: part.raised.length,
    absorbed: part.absorbed.length,
    absorbedBy: tally,
    proposals: landed ? proposals.length : 0,
    // A land that returned null wrote nothing — the message never reached anyone, so the period is
    // not done and the next tick must retry it.
    claimHeld: landed !== null,
  };
}
