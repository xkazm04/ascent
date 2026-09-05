// A BASELINE THE GUARD COULD NOT ESTABLISH — the pure half.
//
// `baseline-unavailable` (persisted as `baseline-red` before 2026-08-31 — see `verify-options.ts`)
// means the repository's resolved command did not pass ON THE LANE'S PRISTINE WORKTREE. The guard
// therefore has nothing green to compare the session against: it cannot reject a regression, cannot
// confirm a fix, and is effectively DISABLED on that repository for as long as the condition holds.
// Everything the loop commits there ships unchecked. That part was, and remains, worth saying out
// loud.
//
// WHAT THIS MODULE USED TO SAY, AND WHY IT WAS FALSE. It read the same measurement as "this
// repository's own check has failed before the session on every loop lane since <date>", raised that
// as a standing concern, and made the NEXT lane's brief lead with repairing it — with a counter that
// reached "attempt 14". Measured on `xkazm04/systedo-case` (2026-08-31): the suite passes in the
// operator's paired checkout, 3744 tests, 0 failing; in a git worktree cut from the same commit, with
// `node_modules` linked exactly as the lane links it, 8 tests fail and every one of them is
// `Error: Could not load the default credentials … GoogleAuth.getApplicationDefaultAsync`.
//
// A worktree deliberately carries TRACKED FILES plus the dependency caches the loop links. Secrets
// and local configuration are gitignored and are correctly not linked. So the measurement supports
// exactly one claim — "the guard cannot establish a baseline here" — and not the other one. The
// damage from getting this wrong was not cosmetic: the loop spent cycles ordering agents to repair a
// green suite, which is also an invitation to make a passing test pass "harder" by weakening it.
//
// TWO CONSUMERS, ONE DERIVATION, and that is the point of putting it here:
//
//   1. THE STANDING SURFACE — `getRedBaselines` (src/lib/db/loop-baselines.ts) folds a repo's lane
//      history into one OBSERVATION for the weekly fleet digest's standing-concerns block, the same
//      channel `detectStandingRegressions` rides. Same shape, same reason: a decline that stopped
//      moving is invisible to every movement-shaped signal, and so is a guard that has been unable to
//      establish a baseline for eleven lanes. Neither is an event. The observation now ends with the
//      two things that would actually fix it, both of which are in the OPERATOR's hands.
//   2. THE BRIEF — `unverifiedCycleBrief` produces the NEUTRAL note the lane's prompt carries
//      (src/lib/org/followups.ts, `UnverifiedCycleBrief`): this cycle cannot be verified, so be
//      correspondingly conservative. It does not lead, it does not rank above the batch, and there is
//      no attempt counter, because there is no repair to attempt.
//
// Pure: no env, no Date, no I/O. The one thing it reaches for is `neutralize`, because the failure
// lines it carries are REPOSITORY-AUTHORED TEXT on its way into a model prompt.

import { neutralize } from "@/lib/llm/untrusted";
import type { UnverifiedCycleBrief } from "@/lib/org/followups";
import type { VerifyVerdict } from "@/lib/local/verify-options";

/** One lane's guard record, as both consumers read it. Timestamps are STRINGS (wire-safe.ts), and
 *  every list in this module is NEWEST-FIRST — the order every history reader already returns. */
export interface BaselineLaneRow {
  repoFullName: string;
  /** `null` is a lane written BEFORE the guard existed: unknown, which is not `skipped` and is not a
   *  green baseline either. Such a lane is skipped by the walk rather than breaking the run. */
  verifyVerdict: VerifyVerdict | null;
  verifyCommand: string | null;
  verifyNote: string | null;
  /** ISO. The lane's own end, else its start, else its run's start. */
  at: string;
}

/** How much of the command's failing output travels — to the digest as evidence, and into the brief
 *  as context. Bounded twice (lines AND characters) because the guard's own note is already capped at
 *  `firstFailureLines`' 6 lines / 800 chars and a second surface should be tighter, not looser: a
 *  digest line and a prompt note are both places where fifty lines of stack trace would bury the
 *  sentence that matters. */
export const BASELINE_EVIDENCE_LINES = 4;
export const BASELINE_EVIDENCE_CHARS = 400;

/** `2026-08-14T09:02:00.000Z` → `2026-08-14`. Dates, not timestamps — the same rule the standing
 *  concerns follow: a shortfall is measured in lanes and days, and a wall-clock time would imply a
 *  precision the observation does not have. */
const dayOf = (iso: string): string => iso.slice(0, 10);

/**
 * WHAT THE OPERATOR CAN ACTUALLY DO — one sentence, shared by every surface that reports an
 * unestablished baseline.
 *
 * Both halves are true, specific, and in the operator's hands, which is what the old "restore your
 * failing check" instruction was not. The resolution chain already prefers a manifest declaration
 * over everything else (`lane-verify.ts`), so `controls.ciHardPass` is not advice about some future
 * feature: wiring it there is read on the next lane.
 */
export const BASELINE_REMEDY =
  "To make this repository verifiable, declare a command that runs from a clean checkout at `controls.ciHardPass` in " +
  "`.ai/manifest.yaml` (the guard prefers it over anything it infers), or turn `verifyMode` off for this repository.";

/**
 * The command's failing output, extracted from the note the guard persisted, BOUNDED and NEUTRALIZED.
 *
 * Neutralized because this is text the scanned repository wrote and it is going into a model prompt:
 * `neutralize` removes forged `<untrusted_repo_data>` markers and collapses backtick runs, which is
 * also what makes it safe for the brief to quote these lines inside a ``` fence. Same treatment
 * `lane-brief.ts` gives every foreign fragment it renders.
 *
 * The note's shape is `… First failure: <lines>` (lane-guard.ts). A note with no such marker yields
 * NO lines rather than the whole sentence: the guard's own prose is not the command's output, and
 * quoting it back as "verbatim from the repository" would be a small lie.
 */
export function baselineFailureLines(
  note: string | null | undefined,
  opts: { maxLines?: number; maxChars?: number } = {},
): string[] {
  const maxLines = opts.maxLines ?? BASELINE_EVIDENCE_LINES;
  const maxChars = opts.maxChars ?? BASELINE_EVIDENCE_CHARS;
  const tail = (note ?? "").split("First failure:")[1];
  if (!tail) return [];
  const out: string[] = [];
  let budget = maxChars;
  for (const raw of tail.split(/\r?\n/)) {
    if (out.length >= maxLines || budget <= 0) break;
    const line = neutralize(raw).trim();
    if (!line) continue;
    const clipped = line.slice(0, budget);
    out.push(clipped);
    budget -= clipped.length;
  }
  return out;
}

/** The unbroken run of `baseline-unavailable` at the HEAD of a repo's lane history. */
export interface UnavailableBaselineRun {
  /** Consecutive newest lanes on which no baseline could be established. Always ≥ 1. */
  lanes: number;
  /** The command the newest of them ran. `null` only if the row lost it. */
  command: string | null;
  /** The newest such lane's persisted note — where the failing output is quoted from. */
  note: string | null;
  /** ISO of the OLDEST lane in the run: when the condition was first seen. */
  since: string;
  /** ISO of the NEWEST lane in the run. */
  latest: string;
}

/**
 * The consecutive `baseline-unavailable` run at the head of `lanes` (newest-first), or `null`.
 *
 * A lane with NO verdict is SKIPPED, not counted and not a break: it is a lane written before the
 * guard existed, and reading "unknown" as "a baseline was established then" would silently shorten
 * every run that spans the guard's own introduction. A `verified`, `rejected` or `skipped` lane DOES
 * break the run — `verified` and `rejected` both prove a baseline WAS established, and `skipped`
 * means the guard was off or nothing resolved, which is not evidence the condition still holds.
 *
 * ONE lane is enough. Unlike a score, which needs persistence to be told apart from noise, "no
 * baseline could be established" is a binary measurement with no noise band — and waiting three lanes
 * to say so buys three more lanes of unverifiable commits.
 */
export function consecutiveUnavailableBaseline(lanes: readonly BaselineLaneRow[]): UnavailableBaselineRun | null {
  const known = lanes.filter((l) => l.verifyVerdict != null);
  const head = known[0];
  if (!head || head.verifyVerdict !== "baseline-unavailable") return null;
  let n = 0;
  let oldest = head;
  for (const lane of known) {
    if (lane.verifyVerdict !== "baseline-unavailable") break;
    n += 1;
    oldest = lane;
  }
  return { lanes: n, command: head.verifyCommand, note: head.verifyNote, since: oldest.at, latest: head.at };
}

/**
 * The one-line, cause-free rendering for the standing-concerns block.
 *
 * It states the same three things a standing regression states — what, since when, and how long it
 * has held — plus the CONSEQUENCE, which is the part that makes it worth a reader's attention (a
 * guard that is off, not a score that fell), plus the REMEDY, which is the part that makes it worth
 * their time.
 *
 * WHAT IT DOES NOT SAY, deliberately: that the repository's checks are failing. The measurement is
 * from an isolated worktree that carries no gitignored local state, and it does not support that
 * claim. It attributes nothing and names no actor, exactly like every other line in that block.
 */
export function unavailableBaselineObservation(run: UnavailableBaselineRun): string {
  const cmd = run.command ? `\`${run.command}\`` : "the check Ascent resolved for this repository";
  const held =
    run.lanes === 1
      ? `did not pass in the loop's isolated worktree on the lane of ${dayOf(run.latest)}`
      : `has not passed in the loop's isolated worktree on any loop lane since ${dayOf(run.since)} (${run.lanes} lanes)`;
  return (
    `${cmd} ${held}. A worktree carries tracked files plus linked dependency caches and none of the gitignored ` +
    `local state a check may need, so this is not a reading of the repository's own checks. With no baseline the ` +
    `degradation guard cannot compare anything, so nothing the loop commits here is verified. ${BASELINE_REMEDY}`
  );
}

/** What the guard measured on the PRISTINE tree this cycle, before the agent touched anything.
 *  `unmeasured` is the guard being off or resolving no command — which is not an established
 *  baseline. `established` is the only state that means the cycle can be verified. */
export type BaselineState = "unavailable" | "established" | "unmeasured";

/**
 * The NEUTRAL note this lane's brief carries when the guard could not establish a baseline — or
 * `null` when it could.
 *
 * WHAT THIS REPLACED. It used to decide whether the brief LED with "restore `npm run test:unit`
 * (attempt 14)". That manufactured repair work out of a measurement that never supported it, and
 * pointed an agent at a suite that is green in the operator's checkout. There is no cheap way to
 * learn whether the failure reproduces outside the worktree, so the honest move is not to guess: the
 * brief now says only that this cycle cannot be verified and that the agent should be correspondingly
 * conservative (`followups.ts`).
 *
 * The rule, and the order matters:
 *
 *   • `established` → `null`, ALWAYS, however long the history is. A baseline exists now; a note
 *     saying otherwise would describe a cycle that is not this one.
 *   • `unavailable`  → note. `lanes` counts THIS lane on top of the consecutive lanes behind it — a
 *     measurement of how long the condition has held, for the OPERATOR's lesson row. It is not an
 *     attempt count and nothing asks an agent to act on it.
 *   • `unmeasured`   → note only if the previous lane was `baseline-unavailable`, carrying THAT
 *     lane's command and note. The guard being off changes nothing, and the last thing actually
 *     measured is still the best evidence available — but the count does not grow, because this lane
 *     measured nothing to add to it.
 */
export function unverifiedCycleBrief(args: {
  repo: string;
  /** The repo's PREVIOUS lanes, newest-first — this cycle's own row has no verdict yet. */
  prior: readonly BaselineLaneRow[];
  current: BaselineState;
  /** This cycle's own measurement, when no baseline could be established. Falls back to the previous
   *  lane's. */
  command?: string | null;
  note?: string | null;
}): UnverifiedCycleBrief | null {
  if (args.current === "established") return null;
  const run = consecutiveUnavailableBaseline(args.prior);
  if (args.current === "unmeasured") {
    if (!run) return null;
    return {
      repo: args.repo,
      command: run.command,
      failure: baselineFailureLines(run.note),
      lanes: run.lanes,
      since: dayOf(run.since),
    };
  }
  const command = args.command ?? run?.command ?? null;
  const note = args.note ?? run?.note ?? null;
  return {
    repo: args.repo,
    command,
    failure: baselineFailureLines(note),
    lanes: (run?.lanes ?? 0) + 1,
    // The run's own start when there is one; otherwise this is the FIRST lane to record it and there
    // is no "since" to state. A date invented from the clock here would be a claim about history.
    since: run ? dayOf(run.since) : null,
  };
}

/**
 * The lesson the operator sees — a STANDING FACT about this repository and this command, phrased so
 * it reads the same however many lanes hit it, and ending with what would fix it.
 *
 * `recordRedBaselineLesson` (src/lib/db/loop-lessons.ts) keeps ONE row per repository and refreshes
 * its text as the lane count grows, rather than filing a new candidate every lane: an event-shaped
 * write would have produced twenty-one rows in the campaign that exposed this, which is a review queue
 * nobody finishes.
 */
export function unverifiedCycleLesson(repo: string, brief: UnverifiedCycleBrief): string {
  const cmd = brief.command ? `\`${brief.command}\`` : "the check Ascent resolved for it";
  const held = brief.since ? `, and has not on any lane since ${brief.since} (${brief.lanes} lanes)` : "";
  return (
    `${unverifiedCycleLessonKey(repo)}${cmd} did not pass in the loop's isolated worktree${held}. A worktree carries ` +
    `no gitignored local state, so this is not a reading of the repository's own checks and no lane is asked to ` +
    `repair them. Until a baseline can be established nothing the loop commits here is verified. ${BASELINE_REMEDY}`
  );
}

/** The stable prefix `recordRedBaselineLesson` keys its one-row-per-repo lookup on. Deliberately free
 *  of the command, the date and the count — all three change while the fact does not. */
export const unverifiedCycleLessonKey = (repo: string): string => `Baseline unavailable on ${repo}: `;

/** THE PREFIX THIS ROW USED TO CARRY, matched alongside the current one so the repository's single
 *  lesson row is REWRITTEN with the corrected wording rather than joined by a second row still
 *  claiming "Red baseline on <repo>: … the lane brief now leads with restoring it". A stale claim
 *  left pending in a review queue is exactly the damage this change exists to undo. */
export const legacyUnverifiedCycleLessonKey = (repo: string): string => `Red baseline on ${repo}: `;
