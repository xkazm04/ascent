// ONE CEILING FOR SELF-REPORTED SKILL INVOCATIONS, whichever door the count arrives through.
//
// Two doors accept an agent's own claim that a skill ran, and both feed the same dormancy verdict and
// ranking: the MCP write tool `report_skill_invoke` (a per-token DAILY count, `write-gate.ts`) and the
// registry `usage/` lane (a per-contributor count over a declared window, `usage-samples.ts`). The
// planned mentor share is a third. A ceiling declared separately at each door drifts, and the loosest
// door becomes the one an inflating contributor uses, so the number lives here and both import it.
//
// The unit is one reporting identity (a token, a contributor file) per day. It is set where a
// well-behaved agent never sees it: a single long session legitimately invokes many skills many
// times, and 500 a day is still far past that.

/** The most skill invocations one reporting identity may claim in one day. */
export const SKILL_INVOKES_PER_DAY_CEILING = 500;

/** The usage lane's normalized window. Every contribution is re-expressed as a rate over this. */
export const USAGE_WINDOW_DAYS = 30;

/** The same ceiling over the usage lane's normalized window: one contributor's 30-day total. */
export const SKILL_INVOKES_PER_WINDOW_CEILING = SKILL_INVOKES_PER_DAY_CEILING * USAGE_WINDOW_DAYS;
