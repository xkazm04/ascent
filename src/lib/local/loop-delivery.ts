// DELIVERY — what happens to a lane's branch once its cycle has succeeded.
//
// One function, called from the engine after every finished lane, that dispatches on the run's
// recorded mode (`src/lib/local/delivery-options.ts`):
//
//   • `branch` — RETURNS IMMEDIATELY, having read nothing and written nothing. This is not an
//     optimisation: `branch` must be byte-identical to the loop as it was before delivery existed,
//     and the way to guarantee that is for the code path to be empty rather than merely harmless.
//   • `land`   — `landLaneBranch`: fast-forward the branch into the paired checkout's CURRENT branch.
//                Every attempt is logged on the lane; a refusal also records a lesson candidate, so
//                the operator learns WHY without reading a diff.
//   • `pr`     — `openPrForLane`, the SAME path the outcome sheet's one-click action uses. Not a
//                second PR implementation: it pushes the real branch with git and POSTs `/pulls`,
//                reuses an already-open PR on GitHub's 422, and writes the `ImprovementPr` ledger row
//                and the lane's denormalized `prNumber`/`prUrl`. The only thing this skips is the
//                typed repo-name confirmation, and it skips it because the operator already gave that
//                consent when they armed the run with `pr` — an unattended loop cannot be asked.
//
// NOTHING HERE CAN FAIL A RUN. A lane's real work is committed and safe on its branch before delivery
// is even considered; a delivery that cannot happen is information for the operator, never a reason
// to throw away a cycle that succeeded.
//
// VERIFICATION ON MEANS ONLY A VERIFIED LANE IS DELIVERED. `rejected` is one of FOUR verdicts, and
// gating on it alone reads the guard backwards. In run a97baf88 (2026-08-30, `delivery: land`,
// `verifyMode: on`) every cycle on both repositories returned `baseline-red` — each repo's own test
// command was already failing, so nothing the loop produced was ever checked — and every lane landed
// into the operator's real working branch regardless, because only `rejected` was refused. Turning the
// guard on is a request that changes be CHECKED before they reach a branch; `baseline-red`, `skipped`
// and an absent verdict all mean the check could not be MADE, which is not permission to land. So
// under `verifyMode: on` a lane is delivered by `land` or `pr` only when its verdict is `verified`,
// the refusal names the verdict on the lane log, and a standing lesson row carries the cause into the
// review queue. Under `verifyMode: off` nothing changes: the operator opted out of checking, and only
// `rejected` blocks — which cannot occur with the guard off.
//
// A REJECTED LANE IS NEVER DELIVERED, WHATEVER MODE THE RUN ASKED FOR. The A/B degradation guard
// (`lane-guard.ts`) already stops such a lane before it commits, so in practice `commits === 0` would
// turn it away below — but "in practice" is not the standard for the one code path that merges into a
// working copy or pushes to a remote. The verdict is checked EXPLICITLY and first, so a lane that
// somehow arrived here with a commit and a `rejected` verdict is still refused, and the refusal is
// written on the lane rather than being an unexplained silence.

import { deliveryOf, type LoopDelivery } from "@/lib/local/delivery-options";
import { landLaneBranch, type LandOutcome } from "@/lib/local/loop-land";
import { openPrForLane } from "@/lib/local/loop-pr";
import { isAppConfigured } from "@/lib/github/app";
import { appendLaneLog, getLane } from "@/lib/db/loop-runs";
import { recordLandRefusalLesson, recordUnverifiedRefusalLesson } from "@/lib/db/loop-lessons";
import { unverifiedDeliveryReason } from "@/lib/local/verify-options";
import { verifyModeOf } from "@/lib/local/run-limits";
import type { LoopLaneRecord } from "@/lib/db/loop-runs-types";

export interface DeliverLaneInput {
  /** The run's recorded mode. Anything unrecognised (including null) is `branch`. */
  delivery: string | null | undefined;
  /** The run's recorded GUARD mode, read off the row exactly like `delivery`. Null/absent is `on`
   *  (`verifyModeOf`) — the guard is the default posture, so a run that never recorded the dial ran
   *  with it, and its lanes are held to the verified-only rule. */
  verifyMode?: string | null;
  orgSlug: string;
  orgId: string;
  laneId: string;
  /** The operator's paired working copy — the checkout a `land` merges into, and the clone a `pr`
   *  pushes from. */
  pairedPath: string;
  /** GitHub login on the run, for the PR ledger's `openedBy`. */
  actor: string | null;
}

export interface DeliverDeps {
  land: typeof landLaneBranch;
  openPr: typeof openPrForLane;
  /** Whether this deployment has a GitHub App at all — `pr` is honestly unavailable without one. */
  appConfigured: () => boolean;
  getLane: (id: string) => Promise<LoopLaneRecord | null>;
  log: (laneId: string, line: string) => Promise<unknown>;
  noteRefusal: (orgSlug: string, repo: string, cause: string) => Promise<unknown>;
  /** The standing lesson for "you asked for verification and this lane was never verified". Separate
   *  from `noteRefusal` because the two say different things: one is about your checkout, this one is
   *  about the repository's own gate. */
  noteUnverified: (orgSlug: string, repo: string, reason: string) => Promise<unknown>;
}

export const defaultDeliverDeps: DeliverDeps = {
  land: landLaneBranch,
  openPr: openPrForLane,
  appConfigured: isAppConfigured,
  getLane,
  log: appendLaneLog,
  noteRefusal: recordLandRefusalLesson,
  noteUnverified: recordUnverifiedRefusalLesson,
};

export interface DeliverResult {
  mode: LoopDelivery;
  delivered: boolean;
  /** The line written to the lane log, or null when nothing was attempted. */
  reason: string | null;
  land?: LandOutcome;
}

export async function deliverLane(input: DeliverLaneInput, overrides: Partial<DeliverDeps> = {}): Promise<DeliverResult> {
  const mode = deliveryOf(input.delivery);
  // THE EMPTY PATH. See the header: `branch` reads nothing and writes nothing.
  if (mode === "branch") return { mode, delivered: false, reason: null };

  const deps: DeliverDeps = { ...defaultDeliverDeps, ...overrides };
  const lane = await deps.getLane(input.laneId).catch(() => null);
  if (!lane || !lane.branch) return { mode, delivered: false, reason: null };
  // THE GUARD'S VETO, checked before anything else this function can do. See the header.
  if (lane.verifyVerdict === "rejected") {
    const reason =
      `Not delivering ${lane.branch}: the degradation guard rejected this cycle — the repository's own check passed before the ` +
      `session and failed after it, so the work was discarded rather than committed. A rejected lane is never landed and never opened as a PR.`;
    await deps.log(input.laneId, reason).catch(() => null);
    return { mode, delivered: false, reason };
  }
  // A lane that committed nothing has nothing to deliver, and saying so would just repeat the "0
  // commit(s) landed this cycle" line the lane already carries.
  if (lane.commits === 0) return { mode, delivered: false, reason: null };
  // THE OPERATOR ASKED FOR VERIFICATION. See the header: only `verified` delivers, and the refusal
  // says WHICH verdict held the work back — "it committed but nothing moved" is otherwise
  // indistinguishable from a bug. Checked AFTER the commit count: a lane that committed
  // nothing has nothing to hold back, and a refusal (and a lesson row) on every empty lane would be
  // noise about work that does not exist.
  const unverified = verifyModeOf(input.verifyMode) === "on" ? unverifiedDeliveryReason(lane.verifyVerdict) : null;
  if (unverified) {
    const verb = mode === "pr" ? "opening a PR for" : "landing";
    const reason =
      `Not ${verb} ${lane.branch}: this run asked for verification (verifyMode: on) and ${unverified}. ` +
      `Verification being on means the work is checked BEFORE it reaches your branch, so a verdict other than "verified" ` +
      `keeps it on ${lane.branch} — the commits are safe there and merging them is yours to do.`;
    await deps.log(input.laneId, reason).catch(() => null);
    await deps.noteUnverified(input.orgSlug, lane.repoFullName, unverified).catch(() => null);
    return { mode, delivered: false, reason };
  }

  if (mode === "land") {
    const outcome = await deps.land(input.pairedPath, lane.branch).catch(
      (err: unknown): LandOutcome => ({
        landed: false,
        refusal: "git-failed",
        reason: `Could not land ${lane.branch}: ${err instanceof Error ? err.message : String(err)}`,
      }),
    );
    await deps.log(input.laneId, outcome.reason).catch(() => null);
    // `already` is a no-op, not a refusal to explain: it is what a second land of the same branch
    // looks like, and a lesson about it would be noise.
    if (outcome.refusal && outcome.refusal !== "already") {
      await deps.noteRefusal(input.orgSlug, lane.repoFullName, refusalCause(outcome)).catch(() => null);
    }
    return { mode, delivered: outcome.landed, reason: outcome.reason, land: outcome };
  }

  // `pr` — HONESTLY UNAVAILABLE rather than silently downgraded. A run armed for PRs that quietly
  // left branches behind would be the worst of both: the operator believes their work is in review.
  if (!deps.appConfigured()) {
    const reason = `Not opening a PR for ${lane.branch}: this deployment has no GitHub App configured, so Ascent cannot open one. The work is on the branch.`;
    await deps.log(input.laneId, reason).catch(() => null);
    return { mode, delivered: false, reason };
  }
  try {
    const res = await deps.openPr({
      orgSlug: input.orgSlug,
      orgId: input.orgId,
      lane,
      pairedPath: input.pairedPath,
      actor: input.actor,
    });
    const reason = `${res.reused ? "Reused" : "Opened"} PR #${res.prNumber} for ${lane.branch} — ${res.prUrl}`;
    await deps.log(input.laneId, reason).catch(() => null);
    return { mode, delivered: true, reason };
  } catch (err) {
    // `openPrForLane` throws only `AppApiError`, whose `body` is already a sentence written for a
    // human — including git's own words on a rejected push, which is the one message that tells the
    // operator which of three very different things went wrong.
    const detail = err instanceof Error ? (err as { body?: string }).body ?? err.message : String(err);
    const reason = `Could not open a PR for ${lane.branch}: ${detail} The work is on the branch.`;
    await deps.log(input.laneId, reason).catch(() => null);
    return { mode, delivered: false, reason };
  }
}

/** The stable, branch-free sentence a refusal becomes in the lesson queue. */
function refusalCause(outcome: LandOutcome): string {
  switch (outcome.refusal) {
    case "detached":
      return "the checkout is on a detached HEAD, so there is no branch to land into";
    case "diverged":
      return "the branch your checkout is on has moved on, so the lane's branch is no longer a fast-forward";
    case "uncommitted":
      return "you have uncommitted changes in files the lane also changed, and landing would overwrite them";
    default:
      return "git refused the fast-forward merge";
  }
}
