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
//
// PURE: no db, no clock of its own (every function takes `now`), no `process`. The two runner-wide
// breakers are decided here and ACTED on by the driver (`runner.ts`); the two per-repo ones are decided
// in `runner-policy.ts`, beside the dry backoff they compete with.

import { DEFAULT_SPEND_CEILING_MICROS, type RunnerPauseReason } from "@/lib/local/runner-types";

export interface SessionLimitVerdict {
  limited: boolean;
  /** When the CLI said the limit resets, when it said so and it parsed. ISO. */
  resetAt: string | null;
}

/** A runner-wide breaker that fired: the reason, when it lifts, and the sentence every surface prints. */
export interface RunnerBreakerHit {
  reason: RunnerPauseReason;
  /** ISO. Always set for the two runner-wide breakers — each has a moment it lifts by itself. */
  until: string;
  note: string;
}

/** Micro-cents per USD — the lane cost unit (`agent-envelope.ts`: `round(total_cost_usd * 100 * 1e6)`). */
export const MICROS_PER_USD = 100 * 1_000_000;
/** A session limit whose reset the CLI did not name (or named unparseably) pauses this long. */
export const SESSION_LIMIT_FALLBACK_MS = 3_600_000;
/** A reset time already in the past still pauses this long — the quota said no a moment ago. */
export const SESSION_LIMIT_MIN_PAUSE_MS = 300_000;

// ── session limit ────────────────────────────────────────────────────────────────────────────────
//
// The Claude CLI has worded this several ways across versions, and the runner meets whichever build
// the operator has installed. Tolerant on purpose, but narrow in one direction: a limit on the
// ACCOUNT (session, usage, 5-hour, weekly, daily) — never an API `rate limit`, a token/context limit,
// or the loop's own "session exceeded 20 min" watchdog, none of which a pause would cure.

const LIMIT_KIND = String.raw`(?:session|usage|5-hour|five-hour|weekly|daily)`;
const LIMIT_SHAPES: readonly RegExp[] = [
  /\bclaude(?: ai)? usage limit reached\b/i,
  new RegExp(String.raw`\b(?:hit|reached|exceeded)\b[^.\n|]{0,40}\b${LIMIT_KIND}\s+limit\b`, "i"),
  new RegExp(String.raw`\b${LIMIT_KIND}\s+limit\b[^.\n|]{0,20}\b(?:reached|hit|exceeded)\b`, "i"),
];

const EPOCH = /\|\s*(\d{10}|\d{13})\b/;
const RELATIVE = /\bresets?\s+in\s+(?:(\d+)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?/i;
const ABSOLUTE =
  /\bresets?\b(?:\s+at)?\s+(?:(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?,?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?![\d:])/i;
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function parseEpoch(text: string): Date | null {
  const m = EPOCH.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return new Date(m[1]!.length === 13 ? n : n * 1000);
}

function parseRelative(text: string, now: Date): Date | null {
  const m = RELATIVE.exec(text);
  if (!m || (m[1] == null && m[2] == null)) return null;
  const ms = (Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60_000;
  return ms > 0 ? new Date(now.getTime() + ms) : null;
}

/** "resets 3pm", "resets at 15:00", "will reset at 3:30 PM (Europe/Prague)", "resets Mon 9am". The
 *  time is read in the SERVER's local zone — the CLI prints the machine's, and on a self-hosted
 *  deployment that is the same machine. A bare hour with neither am/pm nor minutes is ambiguous and
 *  refused, so it falls back to +60 min rather than to a guess. */
function parseAbsolute(text: string, now: Date): Date | null {
  const m = ABSOLUTE.exec(text);
  if (!m) return null;
  const [, day, hh, mm, ampm] = m;
  if (!ampm && mm == null) return null;
  let hour = Number(hh);
  const minute = Number(mm ?? 0);
  if (ampm) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (ampm.toLowerCase() === "pm" ? 12 : 0);
  }
  if (hour > 23 || minute > 59) return null;
  const at = new Date(now);
  at.setHours(hour, minute, 0, 0);
  if (day) {
    const target = WEEKDAYS.indexOf(day.toLowerCase());
    let guard = 0;
    while ((at.getDay() !== target || at.getTime() <= now.getTime()) && guard++ < 8) at.setDate(at.getDate() + 1);
    return at;
  }
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return at;
}

/** Does this agent failure text say the account hit its session/usage limit — and when does it reset? */
export function classifySessionLimit(text: string | null | undefined, now: Date = new Date()): SessionLimitVerdict {
  if (!text || !LIMIT_SHAPES.some((re) => re.test(text))) return { limited: false, resetAt: null };
  const at = parseEpoch(text) ?? parseRelative(text, now) ?? parseAbsolute(text, now);
  return { limited: true, resetAt: at && Number.isFinite(at.getTime()) ? at.toISOString() : null };
}

/** The texts a finished run's lanes offer the classifier: each lane's `error`, and every log line the
 *  lane wrote when its agent failed (`Agent failed: …`, the first line of the CLI's own summary). */
export function sessionLimitTexts(lanes: readonly { error: string | null; log: readonly string[] }[]): string[] {
  const out: string[] = [];
  for (const lane of lanes) {
    if (lane.error) out.push(lane.error);
    for (const line of lane.log) if (line.startsWith("Agent failed:")) out.push(line);
  }
  return out;
}

/** The session-limit breaker over a run's failure texts. Several lanes can name several resets; the
 *  LATEST is the one that is true for all of them. */
export function sessionLimitBreaker(texts: readonly string[], now: Date): RunnerBreakerHit | null {
  let hit = false;
  let latest: number | null = null;
  for (const text of texts) {
    const v = classifySessionLimit(text, now);
    if (!v.limited) continue;
    hit = true;
    if (v.resetAt) latest = Math.max(latest ?? 0, Date.parse(v.resetAt));
  }
  if (!hit) return null;
  const floor = now.getTime() + SESSION_LIMIT_MIN_PAUSE_MS;
  const until = new Date(latest == null ? now.getTime() + SESSION_LIMIT_FALLBACK_MS : Math.max(latest, floor));
  return {
    reason: "session-limit",
    until: until.toISOString(),
    note:
      latest == null
        ? "The agent hit the account's session limit and the CLI did not say when it resets — pausing for an hour."
        : `The agent hit the account's session limit — pausing until it resets (${until.toISOString()}).`,
  };
}

// ── spend ceiling ────────────────────────────────────────────────────────────────────────────────

/** The next local midnight after `now` — when a spend-ceiling pause lifts. */
export function nextLocalMidnight(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  return d;
}

/** The start of `now`'s local day — the window the spend ceiling sums over. */
export function localMidnight(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * A drive's daily ceiling in micro-cents from the operator's USD. OMITTED is the default
 * (`DEFAULT_SPEND_CEILING_MICROS`); `0` or `null` is an explicit "no ceiling". A negative or non-finite
 * value is a caller error the route answers with a 400 — here it reads as the default, never as none.
 */
export function spendCeilingMicrosFrom(usd: number | null | undefined): number | null {
  if (usd === undefined) return DEFAULT_SPEND_CEILING_MICROS;
  if (usd === null || usd === 0) return null;
  if (!Number.isFinite(usd) || usd < 0) return DEFAULT_SPEND_CEILING_MICROS;
  return Math.round(usd * MICROS_PER_USD);
}

/** The inverse, for a resume that has to hand the ceiling back as the operator's unit. */
export const spendCeilingUsdFrom = (micros: number | null | undefined): number | null =>
  micros == null ? null : micros / MICROS_PER_USD;

const usd = (micros: number): string => `$${(micros / MICROS_PER_USD).toFixed(2)}`;

/** The spend breaker: today's lane cost at or past the ceiling pauses until the next local midnight. */
export function spendCeilingBreaker(spentMicros: number | null, ceilingMicros: number | null, now: Date): RunnerBreakerHit | null {
  if (ceilingMicros == null || spentMicros == null || spentMicros < ceilingMicros) return null;
  return {
    reason: "spend-ceiling",
    until: nextLocalMidnight(now).toISOString(),
    note: `Today's lane spend (${usd(spentMicros)}) reached the runner's daily ceiling (${usd(ceilingMicros)}) — pausing until midnight.`,
  };
}
