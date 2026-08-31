// A RED BASELINE AS A STANDING FACT — the pure half.
//
// `baseline-red` is the degradation guard's most consequential verdict and, until this module, its
// quietest. It means the repository's OWN check was already failing before the agent arrived, so the
// guard has nothing green to compare against: it cannot reject a regression, cannot verify a fix, and
// is therefore effectively DISABLED on that repository for as long as the condition holds. Everything
// the loop commits there ships unchecked. That was written to a lane log nobody reads.
//
// Measured on `xkazm04/systedo-case` (2026-08-31): `npm run test:unit` — 294 s, exit 1, one failing
// file, `test-unit/fault-injection-llm.test.mjs` — a test THIS LOOP wrote in an earlier campaign,
// failing on every lane since. Nothing reported it.
//
// TWO CONSUMERS, ONE DERIVATION, and that is the point of putting it here:
//
//   1. THE STANDING SURFACE — `getRedBaselines` (src/lib/db/loop-baselines.ts) folds a repo's lane
//      history into one OBSERVATION for the weekly fleet digest's standing-concerns block, the same
//      channel `detectStandingRegressions` rides. Same shape, same reason: a decline that stopped
//      moving is invisible to every movement-shaped signal, and so is a repository that has been red
//      for eleven lanes. Neither is an event.
//   2. THE BRIEF — `leadWithRedBaseline` decides whether the next lane's prompt LEADS with the repair
//      (src/lib/org/followups.ts, `RedBaselineBrief`). If the loop's own checks cannot run, making
//      them run again is the most valuable thing the loop can do on that repository, and it outranks
//      every armed follow-up in the batch.
//
// Pure: no env, no Date, no I/O. The one thing it reaches for is `neutralize`, because the failure
// lines it carries are REPOSITORY-AUTHORED TEXT on its way into a model prompt.

import { neutralize } from "@/lib/llm/untrusted";
import type { RedBaselineBrief } from "@/lib/org/followups";
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

/** How much of the repository's failing output travels — to the digest as evidence, and into the
 *  brief as a quote. Bounded twice (lines AND characters) because the guard's own note is already
 *  capped at `firstFailureLines`' 6 lines / 800 chars and a second surface should be tighter, not
 *  looser: a digest line and a prompt lead are both places where fifty lines of stack trace would
 *  bury the sentence that matters. */
export const RED_BASELINE_EVIDENCE_LINES = 4;
export const RED_BASELINE_EVIDENCE_CHARS = 400;

/** `2026-08-14T09:02:00.000Z` → `2026-08-14`. Dates, not timestamps — the same rule the standing
 *  concerns follow: a shortfall is measured in lanes and days, and a wall-clock time would imply a
 *  precision the observation does not have. */
const dayOf = (iso: string): string => iso.slice(0, 10);

/**
 * The repository's own failing output, extracted from the note the guard persisted, BOUNDED and
 * NEUTRALIZED.
 *
 * Neutralized because this is text the scanned repository wrote and it is going into a model prompt:
 * `neutralize` removes forged `<untrusted_repo_data>` markers and collapses backtick runs, which is
 * also what makes it safe for the brief to quote these lines inside a ``` fence. Same treatment
 * `lane-brief.ts` gives every foreign fragment it renders.
 *
 * The note's shape is `… First failure: <lines>` (lane-guard.ts). A note with no such marker yields
 * NO lines rather than the whole sentence: the guard's own prose is not the repository's output, and
 * quoting it back as "verbatim from the repository" would be a small lie.
 */
export function baselineFailureLines(
  note: string | null | undefined,
  opts: { maxLines?: number; maxChars?: number } = {},
): string[] {
  const maxLines = opts.maxLines ?? RED_BASELINE_EVIDENCE_LINES;
  const maxChars = opts.maxChars ?? RED_BASELINE_EVIDENCE_CHARS;
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

/** The unbroken run of `baseline-red` at the HEAD of a repo's lane history. */
export interface RedBaselineRun {
  /** Consecutive newest lanes that recorded `baseline-red`. Always ≥ 1. */
  lanes: number;
  /** The command the newest of them ran. `null` only if the row lost it. */
  command: string | null;
  /** The newest red lane's persisted note — where the failing output is quoted from. */
  note: string | null;
  /** ISO of the OLDEST lane in the run: when the repository was first seen red. */
  since: string;
  /** ISO of the NEWEST lane in the run. */
  latest: string;
}

/**
 * The consecutive `baseline-red` run at the head of `lanes` (newest-first), or `null`.
 *
 * A lane with NO verdict is SKIPPED, not counted and not a break: it is a lane written before the
 * guard existed, and reading "unknown" as "it was green then" would silently shorten every run that
 * spans the guard's own introduction. A `verified`, `rejected` or `skipped` lane DOES break the run —
 * `verified` and `rejected` both prove a green baseline was measured, and `skipped` means the guard
 * was off or nothing resolved, which is not evidence the repository is still red.
 *
 * ONE red lane is enough. Unlike a score, which needs persistence to be told apart from noise, "this
 * repository's own check failed" is a binary measurement with no noise band — and waiting three lanes
 * to say so buys three more lanes of unverifiable commits.
 */
export function consecutiveRedBaseline(lanes: readonly BaselineLaneRow[]): RedBaselineRun | null {
  const known = lanes.filter((l) => l.verifyVerdict != null);
  const head = known[0];
  if (!head || head.verifyVerdict !== "baseline-red") return null;
  let n = 0;
  let oldest = head;
  for (const lane of known) {
    if (lane.verifyVerdict !== "baseline-red") break;
    n += 1;
    oldest = lane;
  }
  return { lanes: n, command: head.verifyCommand, note: head.verifyNote, since: oldest.at, latest: head.at };
}

/**
 * The one-line, cause-free rendering for the standing-concerns block.
 *
 * It states the same three things a standing regression states — what, since when, and how long it
 * has held — plus the CONSEQUENCE, which is the part that makes it worth a reader's attention: a red
 * baseline is not a score that fell, it is a guard that is off. It attributes nothing: it does not say
 * who broke the command, or whether the repository or the loop is at fault.
 */
export function redBaselineObservation(run: RedBaselineRun): string {
  const cmd = run.command ? `\`${run.command}\`` : "the check this repository declares for itself";
  const held =
    run.lanes === 1
      ? `failed before the session on the loop lane of ${dayOf(run.latest)}`
      : `has failed before the session on every loop lane since ${dayOf(run.since)} (${run.lanes} lanes)`;
  return (
    `${cmd} — this repository's own check — ${held}. ` +
    `With no green baseline the degradation guard cannot compare anything, so nothing the loop commits here is verified.`
  );
}

/** What the guard measured on the PRISTINE tree this cycle, before the agent touched anything.
 *  `unmeasured` is the guard being off or resolving no command — which is not "green". */
export type BaselineState = "red" | "green" | "unmeasured";

/**
 * Should this lane's brief LEAD with repairing the repository's own checks — and if so, with what?
 *
 * The rule, and the order matters:
 *
 *   • `green` → `null`, ALWAYS, however red the history is. The repository has been repaired; a brief
 *     that still led with the repair would send an agent to fix something that is already fixed, and
 *     would teach it to distrust the lead the next time it is real.
 *   • `red` → lead. `attempt` counts THIS lane on top of the consecutive red lanes behind it, so the
 *     first lane ever to see it says "attempt 1" and the fourth says "attempt 4".
 *   • `unmeasured` → lead only if the previous lane recorded red, carrying THAT lane's command and
 *     note. The guard being off does not repair anything, and the last thing actually measured is
 *     still the best evidence available — but the count does not grow, because this lane measured
 *     nothing to add to it.
 *
 * `attempt > 1` is the NON-CONVERGENCE signal: a previous lane already led with this repair and the
 * command is still failing. The brief says so in as many words (`followups.ts`), and the operator's
 * lesson records it, because "attempt 3" tells them something a silent retry never does.
 */
export function leadWithRedBaseline(args: {
  repo: string;
  /** The repo's PREVIOUS lanes, newest-first — this cycle's own row has no verdict yet. */
  prior: readonly BaselineLaneRow[];
  current: BaselineState;
  /** This cycle's own measurement, when it is red. Falls back to the previous lane's. */
  command?: string | null;
  note?: string | null;
}): RedBaselineBrief | null {
  if (args.current === "green") return null;
  const run = consecutiveRedBaseline(args.prior);
  if (args.current === "unmeasured") {
    if (!run) return null;
    return {
      repo: args.repo,
      command: run.command,
      failure: baselineFailureLines(run.note),
      attempt: run.lanes,
      since: dayOf(run.since),
    };
  }
  const command = args.command ?? run?.command ?? null;
  const note = args.note ?? run?.note ?? null;
  return {
    repo: args.repo,
    command,
    failure: baselineFailureLines(note),
    attempt: (run?.lanes ?? 0) + 1,
    // The run's own start when there is one; otherwise this is the FIRST lane to record it and there
    // is no "since" to state. A date invented from the clock here would be a claim about history.
    since: run ? dayOf(run.since) : null,
  };
}

/**
 * The lesson the operator sees when a lane leads with the repair — a STANDING FACT about this
 * repository and this command, phrased so it reads the same however many lanes hit it.
 *
 * `recordRedBaselineLesson` (src/lib/db/loop-lessons.ts) keeps ONE row per repository and refreshes
 * its text as the attempt count grows, rather than filing a new candidate every lane: an event-shaped
 * write would have produced twenty-one rows in the campaign that exposed this, which is a review queue
 * nobody finishes.
 */
export function redBaselineLesson(repo: string, brief: RedBaselineBrief): string {
  const cmd = brief.command ? `\`${brief.command}\`` : "the check it declares for itself";
  const head = `Red baseline on ${repo}: ${cmd} was already failing before the loop's session`;
  const since = brief.since ? `, and has been on every lane since ${brief.since}` : "";
  const tail =
    brief.attempt > 1
      ? ` The lane brief has now led with this repair ${brief.attempt} times and the command still fails — the repair is not converging, and it is worth a human looking at what the loop keeps missing.`
      : " The lane brief now leads with restoring it, ahead of the armed batch.";
  return (
    `${head}${since}. Until it passes the degradation guard has no green baseline to compare against, so nothing ` +
    `the loop commits here is verified.${tail}`
  );
}

/** The stable prefix `recordRedBaselineLesson` keys its one-row-per-repo lookup on. Deliberately
 *  free of the command, the date and the attempt count — all three change while the fact does not. */
export const redBaselineLessonKey = (repo: string): string => `Red baseline on ${repo}: `;
