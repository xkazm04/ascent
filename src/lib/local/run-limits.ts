// THE RUN'S THROUGHPUT AND SAFETY DIALS — how much one lane may bite off, how long its session may
// take, and whether the degradation guard runs at all.
//
// WHY THIS MODULE EXISTS. A 21-run campaign on two real repositories (kp, systedo-case) produced 34
// commits and moved kp's overall 83→82 and systedo-case's 84→88. The owner's reading of it: after
// twenty runs on small codebases the loop should have produced "well structured, deduplicated,
// blazingly fast code", and instead it shows HESITANCE — it never makes a large change. Three of the
// causes are numbers that were hard-coded rather than chosen: the batch was a fixed 5, the agent's
// session ceiling a fixed 20 minutes, and nothing verified a bold change so nothing could be bold
// safely. All three become per-run parameters here.
//
// DEPENDENCY-FREE (no `process`, no `node:*`), for exactly the reason `agent-options.ts` and
// `delivery-options.ts` are: the cockpit's pickers and the API route's validators have to agree, and
// the way that stops being true is two lists. Environment resolution stays in `agent.ts`.
//
// EVERY NORMALIZER RETURNS `null` FOR ANYTHING IT DOES NOT RECOGNISE, AND NEVER A GUESS. `null` means
// "this caller did not choose one", which the run records as null and the engine reads as the
// deployment default. It does NOT mean "clamp it to something plausible": a request for a batch of
// 40 is a request the caller got wrong, and the route answers it with a 400 naming the range rather
// than quietly running a batch of 12 the operator never asked for. Same posture `normalizeDelivery`
// and `normalizeAgentModel` take.

/** Follow-ups (or craft rungs) one lane dispatches in one cycle. Unchanged: today's hard-coded 5. */
export const BATCH_SIZE_DEFAULT = 5;

/**
 * The ceiling on a per-run batch. TWELVE, and the number is an argument rather than a round figure.
 *
 * Upward pressure: five items is roughly one item per five minutes of a twenty-minute session, which
 * is what produced the campaign's small, item-shaped changes. A batch that spans a dozen related
 * items is the one that makes "these six files all do the same thing badly" visible to the agent at
 * all — de-duplication is not reachable from a batch of one.
 *
 * Downward pressure, and why it is not 30: every item in the batch is CLAIMED before dispatch and
 * released or adjudicated after, so a batch is a lock held over other workers' queue; the brief grows
 * with it, and past roughly a dozen items the per-item instructions stop fitting a session's
 * attention and the agent starts skipping the tail silently. Twelve is also 12 × the smallest useful
 * lane, which keeps the worst case (a lane that fails and releases) bounded at one repo's realistic
 * open list rather than at its whole backlog.
 */
export const BATCH_SIZE_CAP = 12;

/**
 * The batch size a run asked for, or `null` for "use the default".
 *
 * Integers only, inside `[1, BATCH_SIZE_CAP]`. A float, a numeric string, a NaN, a zero, or anything
 * above the cap is `null` — unchosen — and the route turns an explicitly-sent unchosen value into a
 * 400. Nothing here rounds or clamps: see the header.
 */
export function normalizeBatchSize(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isInteger(v)) return null;
  return v >= 1 && v <= BATCH_SIZE_CAP ? v : null;
}

/** The batch a run ACTUALLY works. A null column is the default, which is what every run before this
 *  parameter existed did — byte-identical. */
export const batchSizeOf = (v: number | null | undefined): number => normalizeBatchSize(v) ?? BATCH_SIZE_DEFAULT;

/** Today's per-session ceiling, and still the default: 20 minutes (`ASCENT_AUTOPILOT_TIMEOUT_MS`). */
export const AGENT_TIMEOUT_DEFAULT_MS = 1_200_000;
/** Floor. The same "0 is a misconfiguration, not 'no timeout'" rule every other timeout knob has. */
export const AGENT_TIMEOUT_MIN_MS = 60_000;
/**
 * The hard ceiling on a per-run session timeout: NINETY MINUTES.
 *
 * A campaign lane literally committed `Agent session exceeded 20 min and was stopped` — a structural
 * change that was underway when the clock ran out, and whose work was then discarded with the
 * worktree. So the knob has to be raiseable. It is capped because the timeout is the ONLY thing that
 * ends a wedged session: a headless `claude -p` waiting on something that will never arrive holds a
 * lane, a worktree and a claim until it fires. Ninety minutes is long enough for a restructuring pass
 * on a small or medium repository and short enough that a stuck run is not an overnight surprise.
 */
export const AGENT_TIMEOUT_CAP_MS = 5_400_000;

/** A per-run agent session timeout, or `null` for "use `ASCENT_AUTOPILOT_TIMEOUT_MS` / the default". */
export function normalizeAgentTimeoutMs(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isInteger(v)) return null;
  return v >= AGENT_TIMEOUT_MIN_MS && v <= AGENT_TIMEOUT_CAP_MS ? v : null;
}

/**
 * THE DEGRADATION GUARD's two states.
 *
 *   • `on`  — the default. Before the agent starts, the lane runs the repository's OWN verification
 *             command on the pristine worktree; after the agent's edits and before the commit, it
 *             runs it again. A pass that became a failure is REJECTED: the edits are discarded in the
 *             throwaway worktree, nothing is committed, and nothing is delivered.
 *   • `off` — no baseline, no result run, no verdict. The lane behaves exactly as it did before the
 *             guard existed. The dial exists because the guard runs REPO-AUTHORED code (see
 *             `lane-guard.ts`), and an operator must be able to say no to that without giving up the
 *             loop.
 */
export const VERIFY_MODES = ["on", "off"] as const;
export type VerifyMode = (typeof VERIFY_MODES)[number];

/** A verify mode from an untrusted value, else `null` for "unchosen" — which reads as `on`. */
export function normalizeVerifyMode(v: unknown): VerifyMode | null {
  return typeof v === "string" && (VERIFY_MODES as readonly string[]).includes(v) ? (v as VerifyMode) : null;
}

/** The mode a run ACTUALLY ran under. A null column means `on`: the guard is the default posture. */
export const verifyModeOf = (v: string | null | undefined): VerifyMode => normalizeVerifyMode(v) ?? "on";

/** Ten minutes. Long enough for a typecheck + unit suite on a small or medium repo; short enough that
 *  a repository whose "test" command starts a dev server does not hold the lane for the whole run. */
export const VERIFY_TIMEOUT_DEFAULT_MS = 600_000;
export const VERIFY_TIMEOUT_MIN_MS = 30_000;
/** Thirty minutes. Past this the guard costs more than the cycle it protects, and a repository whose
 *  own gate takes half an hour wants a narrower command declared in `.ai/manifest.yaml`, not a longer
 *  rope here. */
export const VERIFY_TIMEOUT_CAP_MS = 1_800_000;

/** A per-run verification timeout, or `null` for the default. */
export function normalizeVerifyTimeoutMs(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isInteger(v)) return null;
  return v >= VERIFY_TIMEOUT_MIN_MS && v <= VERIFY_TIMEOUT_CAP_MS ? v : null;
}

export const verifyTimeoutMsOf = (v: number | null | undefined): number =>
  normalizeVerifyTimeoutMs(v) ?? VERIFY_TIMEOUT_DEFAULT_MS;
