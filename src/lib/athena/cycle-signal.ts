// REPORT-OR-ABSORB — the gate that keeps Athena from narrating her own housekeeping.
//
// The autonomous cycle produces outcomes with nobody watching. Every one of them passes THIS
// judgment at the moment it is produced, on the outcome's own terms: does this change what the
// operator would do, or is it maintenance she is supposed to handle quietly?
//
// ── THE FAILURE THIS EXISTS TO MAKE IMPOSSIBLE ──────────────────────────────────────────────────
//
// A person told about six consolidations and one thing that matters learns to skip all seven. That
// is not a tuning problem, it is a structural one: as long as the absorbed outcomes travel BESIDE the
// raised ones — as a list, as a trailing "and 6 routine items", as a count in the message — the
// reader has to do the filtering, and the cheapest filter a human owns is "ignore this sender".
//
// So the separation is enforced by TYPE, not by discipline:
//
//   • {@link partitionCycleOutcomes} returns raised outcomes as `CycleOutcome` (they still carry their
//     prose) and absorbed ones as {@link AbsorbedOutcome} — a record with an id, a kind and a reason
//     and NO TEXT AT ALL. There is nothing in an absorbed outcome for a composer to render, so
//     "accidentally mention the absorbed ones" is not a mistake this module's callers can make.
//   • {@link composeCycleMessage} takes ONLY the raised list. It cannot see the absorbed count, so it
//     cannot append one.
//   • It returns `null` when nothing cleared the bar. Silence is a first-class outcome; a message that
//     says "nothing to report" is contact, and contact is exactly what an absorbed run must not make.
//
// ABSORBED OUTCOMES STILL EXIST. They are counted here ({@link absorbedTally}), recorded on the run's
// own episode and reported in the cron response — inspectable whenever someone asks. They simply do
// not initiate contact.
//
// PURE, and deliberately so: no database, no clock, no Next.js. The judgment about when a machine may
// interrupt a person is the most consequential rule in the cycle and it must be testable without any
// of that.

import { isWithinNoise } from "@/lib/maturity/noise";

/**
 * What kind of thing the cycle produced.
 *
 *   briefing      — her periodic read of the org's standing. The prose of the message.
 *   proposal      — an offer that needs a human to accept or decline it.
 *   consolidation — memory she folded together. Hers to do; nothing changes for the operator.
 *   housekeeping  — anything else she tidied unattended.
 */
export const CYCLE_OUTCOME_KINDS = ["briefing", "proposal", "consolidation", "housekeeping"] as const;
export type CycleOutcomeKind = (typeof CYCLE_OUTCOME_KINDS)[number];

/** The kinds that are maintenance BY DEFINITION and can never initiate contact — see rule 2. */
const MAINTENANCE_KINDS: readonly CycleOutcomeKind[] = ["consolidation", "housekeeping"];

/**
 * One thing the cycle produced, described in FACTS rather than in a verdict.
 *
 * There is deliberately no `important: boolean` on this interface. A flag would move the judgment to
 * whoever built the outcome — which is the model's caller, at the exact moment it is least equipped to
 * be honest about its own output — and this module would become a formatter. Every field below is
 * something the cycle KNOWS; the rules are what turn them into a decision.
 */
export interface CycleOutcome {
  /** Stable within one run. Carried into the absorbed record so an absorbed outcome stays addressable. */
  id: string;
  kind: CycleOutcomeKind;
  /** What she would say if this were raised. Empty means she produced nothing worth a sentence. */
  text: string;
  /** A decision this puts in front of a human — an action id, a finding key. Null when there is none. */
  decision?: string | null;
  /** Cohort-matched movement in the org's standing that this outcome reports, in score points. */
  delta?: number | null;
  /** True when the operator can already read this off a dashboard without her saying it. */
  alreadyVisible?: boolean;
}

export type RaiseReason = "decision_waiting" | "standing_moved" | "explains_a_decision";
export type AbsorbReason = "maintenance" | "within_noise" | "already_visible" | "nothing_to_say";

export type CycleVerdict =
  | { report: true; reason: RaiseReason }
  | { report: false; reason: AbsorbReason };

/**
 * An outcome that did NOT clear the bar, in the only shape anything downstream ever sees it in.
 *
 * NOTE WHAT IS MISSING: `text`. An absorbed outcome is countable, attributable and inspectable, and it
 * is structurally incapable of being rendered into a message — there is no prose on it to render.
 */
export interface AbsorbedOutcome {
  id: string;
  kind: CycleOutcomeKind;
  reason: AbsorbReason;
}

/**
 * The bar, as five ordered rules. Each one is a property of the outcome someone could check by hand.
 *
 *   1. No prose is nothing to say. (An empty outcome cannot be news even if it moved a number.)
 *   2. Maintenance is ABSOLUTE. A consolidation never initiates contact, whatever else is true of it.
 *      This is the rule the whole module exists for; it is checked before anything that could
 *      promote it.
 *   3. A decision waiting on a human always clears the bar. Nothing happens until they answer, so
 *      staying quiet about it is not restraint, it is dropping the thing on the floor.
 *   4. Movement in the standing beyond the noise band clears it. The band is the org's own
 *      (`SCORE_NOISE_BAND` = 2 points): inside it, a "+1" is scan-to-scan wobble wearing a green arrow.
 *   5. Everything else is absorbed — and the reason distinguishes "she is repeating the dashboard"
 *      from "she had nothing".
 */
export function judgeCycleOutcome(outcome: CycleOutcome): CycleVerdict {
  if (!outcome.text?.trim()) return { report: false, reason: "nothing_to_say" };
  if (MAINTENANCE_KINDS.includes(outcome.kind)) return { report: false, reason: "maintenance" };
  const decision = typeof outcome.decision === "string" ? outcome.decision.trim() : "";
  if (decision) return { report: true, reason: "decision_waiting" };
  const delta = outcome.delta;
  if (typeof delta === "number" && Number.isFinite(delta)) {
    if (!isWithinNoise(delta)) return { report: true, reason: "standing_moved" };
    return { report: false, reason: "within_noise" };
  }
  if (outcome.alreadyVisible) return { report: false, reason: "already_visible" };
  return { report: false, reason: "nothing_to_say" };
}

/**
 * The ONE kind a raised decision may drag along with it, and why.
 *
 * A proposal is written in the same transaction as the turn that offered it (athena-threads.ts) for a
 * stated reason: a proposal whose turn was never written is an Accept button under nothing — a card
 * offering an action for a reason nobody can read. So when a decision clears the bar, the briefing
 * prose that EXPLAINS it is raised with it.
 *
 * This is not a hole in rule 2. What gets promoted is the explanation OF the raised item, never a
 * sibling piece of news: maintenance is absorbed in rule 2 before promotion is even considered, and a
 * promoted briefing with no prose stays absorbed because rule 1 already refused it.
 */
const PROMOTED_BY_DECISION: CycleOutcomeKind = "briefing";

export interface CyclePartition {
  /** In input order. The only outcomes anything may render. */
  raised: CycleOutcome[];
  /** Textless by construction — see {@link AbsorbedOutcome}. */
  absorbed: AbsorbedOutcome[];
}

/**
 * Judge every outcome, then apply the one promotion rule. Input order is preserved on both sides, so
 * the briefing (produced first) leads the message it explains.
 */
export function partitionCycleOutcomes(outcomes: readonly CycleOutcome[]): CyclePartition {
  const judged = outcomes.map((outcome) => ({ outcome, verdict: judgeCycleOutcome(outcome) }));
  const decisionRaised = judged.some(
    (j) => j.verdict.report && j.outcome.kind !== PROMOTED_BY_DECISION,
  );

  const raised: CycleOutcome[] = [];
  const absorbed: AbsorbedOutcome[] = [];
  for (const { outcome, verdict } of judged) {
    if (verdict.report) {
      raised.push(outcome);
      continue;
    }
    // Promotion, and its two guards: only the briefing kind is promotable, and only when a REAL
    // decision was raised beside it. `nothing_to_say` is never promoted — there is no prose to promote.
    if (decisionRaised && outcome.kind === PROMOTED_BY_DECISION && verdict.reason !== "nothing_to_say") {
      raised.push(outcome);
      continue;
    }
    absorbed.push({ id: outcome.id, kind: outcome.kind, reason: verdict.reason });
  }
  return { raised, absorbed };
}

/**
 * The message body — or `null` when nothing cleared the bar.
 *
 * It takes ONLY the raised outcomes. That is the point: this function has no way to learn how many
 * were absorbed, so it has no way to mention them. And `null` is a real answer — the caller must land
 * nothing at all rather than sending a "nothing to report" note, which would be contact.
 */
export function composeCycleMessage(raised: readonly CycleOutcome[]): string | null {
  const parts = raised.map((o) => o.text.trim()).filter((t) => t.length > 0);
  if (parts.length === 0) return null;
  return parts.join("\n\n");
}

export type AbsorbedTally = Partial<Record<AbsorbReason, number>>;

/** How many were absorbed, by reason. For the cron response and her own episode — never for a message. */
export function absorbedTally(absorbed: readonly AbsorbedOutcome[]): AbsorbedTally {
  const tally: AbsorbedTally = {};
  for (const a of absorbed) tally[a.reason] = (tally[a.reason] ?? 0) + 1;
  return tally;
}

/**
 * The one line her episode records about a run. Written in her own voice about her OWN work, which is
 * why it may name the absorbed count that a message may not: an episode is memory, not contact.
 */
export function summarizeCycle(part: CyclePartition, landed: boolean): string {
  const tally = absorbedTally(part.absorbed);
  const reasons = Object.entries(tally)
    .map(([reason, n]) => `${n} ${reason}`)
    .join(", ");
  const head = landed
    ? `Ran a periodic cycle and raised ${part.raised.length} item${part.raised.length === 1 ? "" : "s"}.`
    : "Ran a periodic cycle and raised nothing — there was nothing worth interrupting anyone for.";
  return reasons ? `${head} Absorbed ${part.absorbed.length} (${reasons}).` : head;
}
