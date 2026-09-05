// HOW A RUN'S WORK IS DELIVERED — the operator's choice, as a value both the browser and the server
// can hold.
//
// The loop commits each lane to a throwaway `ascent/loop-<stamp>-<slug>` branch and LEAVES IT THERE:
// `removeLoopWorktree` drops the temp checkout and deliberately keeps the branch. Nothing merged it.
// A 21-run campaign measured what that costs — every run's worktree is cut from the same unchanged
// HEAD, so the loop rediscovered and rewrote the same fix run after run, and the repositories did not
// improve until the campaign harness started fast-forwarding the branches itself
// (`scripts/loop-campaign.mjs --land`, a harness-only workaround for a product-level gap).
//
// So delivery becomes a DIAL rather than a hard-coded end. `branch` stays the default and is
// byte-identical to what every run before this did.
//
// This module is deliberately DEPENDENCY-FREE (no `process`, no `node:*`), for the same reason
// `agent-options.ts` is: the cockpit's select and the API route's validator have to agree exactly,
// and the way that stops being true is two lists.

/** The three ways a lane's committed work can reach the operator. */
export const LOOP_DELIVERIES = ["branch", "land", "pr"] as const;
export type LoopDelivery = (typeof LOOP_DELIVERIES)[number];

/**
 * A delivery mode from an untrusted value, or `null` for "this caller did not choose one".
 *
 * NULL IS NEVER A GUESS. An unrecognised string — a stale tab, a hand-rolled request — is not
 * silently promoted to a mode that writes to the operator's working copy; it reads as "unchosen",
 * and `deliveryOf` floors that to `branch`, which is what every run before this column did.
 */
export function normalizeDelivery(v: unknown): LoopDelivery | null {
  return typeof v === "string" && (LOOP_DELIVERIES as readonly string[]).includes(v) ? (v as LoopDelivery) : null;
}

/** The mode a run ACTUALLY ran under. A null column means `branch` — see above. */
export const deliveryOf = (v: string | null | undefined): LoopDelivery => normalizeDelivery(v) ?? "branch";

/**
 * The picker's labels. Named for what the mode does to the OPERATOR'S MACHINE, never for its
 * internal name: "land" is a word about a git merge, and the person choosing it needs to know it
 * merges into the branch they are standing on.
 */
export const DELIVERY_LABELS: Record<LoopDelivery, string> = {
  branch: "Leave on a branch",
  land: "Land in my current branch",
  pr: "Open a PR",
};

/** One line under the picker saying what the chosen mode will do. The `land` hint is the one that
 *  matters: it is the only mode that writes into a real working copy. */
export const DELIVERY_HINTS: Record<LoopDelivery, string> = {
  branch:
    "Each lane commits to its own ascent/loop-… branch and stops there. Nothing merges it — review and merge it yourself.",
  land: "Merges each lane's branch into the branch your paired checkout is on, fast-forward only. A diverged branch or a file you are editing stops it, and the run carries on.",
  pr: "Pushes each lane's branch and opens a draft pull request for it. Needs the GitHub App.",
};

/**
 * The short tag a past run's column header prints, so a reader of the ledger can tell how that run
 * was delivered. `null` for `branch` — it is the default and every historical row is one, so a tag on
 * every column would say nothing. Same rule `laneKindTag` and `laneExecutorTag` follow.
 */
export const deliveryTag = (v: string | null | undefined): string | null => {
  const d = deliveryOf(v);
  return d === "land" ? "landed" : d === "pr" ? "PR" : null;
};
