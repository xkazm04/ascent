// THE RUNNER'S BREAKERS — every one resolves to PAUSE, never to proceed
// (spark theater-upgrade, 2026-09-18; WP2 implements; `hitl-approval/unattended-mode`).
//
//   spend-ceiling    the day's lane cost (local midnight to now) reached the drive's ceiling: the runner
//                    pauses until the next local midnight.
//   session-limit    a lane's agent failed on the account's session limit: the runner pauses until the
//                    reset the CLI named, else +60 min. The whole runner, because every lane shares the quota.
//   repo-failures    `REPO_FAILURE_STREAK` consecutive guard-rejected or failed lanes on one repo: that
//                    repo pauses until the operator resumes it.
//   branch-conflict  the runner branch could not merge its base in: that repo pauses until resumed.
// A paused runner's header says which breaker and until when, on every surface.

export interface SessionLimitVerdict {
  limited: boolean;
  /** When the CLI said the limit resets, when it said so and it parsed. ISO. */
  resetAt: string | null;
}

/** Does this agent failure text say the account hit its session/usage limit? STUB (WP0): never. */
export function classifySessionLimit(_text: string | null | undefined, _now: Date = new Date()): SessionLimitVerdict {
  return { limited: false, resetAt: null };
}

/** The next local midnight after `now` — when a spend-ceiling pause lifts. */
export function nextLocalMidnight(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  return d;
}
