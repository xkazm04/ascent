// Skill dormancy (ported from the Personas skill-drift loop) — the other half of the Org Skills sync
// story: the CLI knows whether a skill's BODY drifted, this knows whether the skill is still USED. For
// each org skill we fold OrgSkillEvent (download | sync) + OrgSkillAdoption into a `lastUsedAt` and one
// of three badge verdicts: new | active | dormant — over five STATES, because `dormant` covers three
// different facts with three different remedies (see SkillUsageState below).
//
// ONE SIGNAL (2026-07-29): the card's "N uses" counter and this badge used to measure disjoint activity —
// "uses" came from OrgSkillDownload (bumped by the web Copy/Download path) while the badge folded only
// OrgSkillEvent, which that path never wrote. A skill copied 40 times read "40 uses · dormant". The fix
// lives at the write end (recordSkillDownload now emits a `download` OrgSkillEvent in the same
// transaction as the tally bump), so both numbers are derived from the same writes and cannot disagree.
// The `invoke` event type was retired in the same change: it ranked highest here but had NO producer
// anywhere, so `active` was unreachable for every skill in production.
//
// The age guard is the point: a library that just judged "no uses in 30 days ⇒ dead" would brand every
// freshly authored/adopted skill dormant on day one and teach the org to ignore the badge. A skill that
// arrived less than 30 days ago and has never been used is NEW (give it a chance), not dormant.
//
// Pure over fetched rows (getOrgSkillUsageRows) so the verdict is unit-testable without a DB.

// Types only: this module is imported by client components, so it must never pull a runtime `@/lib/db`
// symbol into the browser bundle. The reads live in skill-usage-load.ts.
import type { SkillEventStat, SkillUsageRows } from "@/lib/db";

/** `new` = arrived recently, never invoked. `active` = used inside the window. `dormant` = past the
 *  window with no use since. The COARSE badge vocabulary — see {@link SkillUsageState} for the state
 *  that decides whether a `dormant` skill is actually a prune candidate. */
export type SkillUsageVerdict = "new" | "active" | "dormant";

// ── The three states inside `dormant` (D24) ──────────────────────────────────────────────────────
// Prune candidates are drawn from `dormant`, and that one bucket used to mix three different facts:
//   abandoned  — really used at least once, then went quiet past the window. A signal about the
//                ARTIFACT: someone tried it and stopped. This is the honest prune candidate.
//   unused     — old enough to have been found, never used, and the telemetry pathway demonstrably
//                works for this org. A signal about DISCOVERY, not about the skill's worth — the
//                remedy is surfacing it, not deleting it.
//   unmeasured — no event of any kind has EVER been recorded anywhere in this org's library, so the
//                pathway itself is silent. Nothing is known about this skill. Deleting on absent data
//                is unrecoverable, so `unmeasured` is never a prune candidate.
//
// `unmeasured` is decided ORG-WIDE, never per skill, and that is the whole reason it is safe to add.
// The module's own history is the warning: the retired `invoke` verdict had no producer, so `active`
// was unreachable for every skill in production. A per-skill "is this instrumented?" guess would repeat
// that mistake (always-empty or always-full). "This org has emitted zero skill events, ever" is a fact
// the rows already carry, so the state is either genuinely true for the whole library or genuinely
// false — it cannot quietly mis-fire on one skill.
export type SkillUsageState = "new" | "active" | "abandoned" | "unused" | "unmeasured";

/** The coarse badge verdict for a state. `abandoned`/`unused`/`unmeasured` all still READ as dormant;
 *  the split changes what may be ACTED on, not what the badge says. */
export function verdictOfState(state: SkillUsageState): SkillUsageVerdict {
  return state === "new" || state === "active" ? state : "dormant";
}

/**
 * Only an `abandoned` skill is a prune candidate. `unused` is a discovery problem and `unmeasured` is
 * an absence of data — proposing either for deletion is acting on a signal that was never taken.
 */
export function isPruneCandidate(u: Pick<SkillUsage, "state">): boolean {
  return u.state === "abandoned";
}

/** Default days of silence before a skill counts as dormant — also the age below which a never-invoked
 *  skill is still "new" rather than dead. ONE constant so the two halves of the rule can't drift apart;
 *  {@link dormancyWindowFor} preserves that coupling when the window is derived per skill.
 *
 *  Basis: 30 days is a month of working days, the shortest span over which "nobody reached for this"
 *  is meaningful for a frequently-pulled artifact. It is the FLOOR, not the whole rule — see below. */
export const DORMANCY_WINDOW_DAYS = 30;

/** Upper bound on a derived window. Past four months, "dormant" stops being actionable at all: nobody
 *  prunes on a signal that takes a third of a year to appear, and an unbounded derivation would let a
 *  skill used twice in three years claim a window no verdict could ever fall outside. */
export const DORMANCY_WINDOW_MAX_DAYS = 120;

/** Multiple of the observed/declared cadence a skill may miss before it reads dormant. 2 = "missed a
 *  full cycle and then some" — 1 would flip a perfectly punctual quarterly skill to dormant the day
 *  before its next scheduled use. */
const CADENCE_SLACK = 2;

/**
 * The dormancy window for ONE skill, derived from its own cadence (D44). A flat 30 days is defensible
 * for a library of frequently-pulled artifacts and wrong for a quarterly one: a release-checklist skill
 * used correctly once a quarter read `dormant` for two months of every three and became a prune
 * candidate for being used exactly as intended.
 *
 * Order of authority:
 *   1. a DECLARED `cadenceDays` on the skill (an author saying "this is quarterly")
 *   2. the OBSERVED cadence — mean days between uses over the skill's own life (`ageDays / useCount`),
 *      which needs at least two uses before it means anything
 *   3. the constant, when neither exists
 * The result is clamped to [DORMANCY_WINDOW_DAYS, DORMANCY_WINDOW_MAX_DAYS]: the derivation may only
 * LENGTHEN a window, never shorten it below the floor a new skill is judged against.
 */
export function dormancyWindowFor(input: { cadenceDays?: number | null; ageDays: number; useCount: number }): number {
  const declared = input.cadenceDays && input.cadenceDays > 0 ? input.cadenceDays : null;
  const observed = input.useCount >= 2 && input.ageDays > 0 ? input.ageDays / input.useCount : null;
  const cadence = declared ?? observed;
  if (cadence === null) return DORMANCY_WINDOW_DAYS;
  const derived = Math.round(cadence * CADENCE_SLACK);
  return Math.min(DORMANCY_WINDOW_MAX_DAYS, Math.max(DORMANCY_WINDOW_DAYS, derived));
}

export interface SkillUsage {
  skillId: string;
  /** The coarse badge verdict, derived from `state` — never assign it independently. */
  verdict: SkillUsageVerdict;
  /** The full state (D24). `dormant` splits into abandoned | unused | unmeasured; only `abandoned` is
   *  a prune candidate ({@link isPruneCandidate}). */
  state: SkillUsageState;
  /** Latest use: the newest `download` when there is one, else the newest `sync`. Null = never used. */
  lastUsedAt: string | null;
  /** Which event kind `lastUsedAt` came from — a `download` is a real use, a `sync` is only a pull. */
  lastUsedType: "download" | "sync" | null;
  /** Whole days since `lastUsedAt` (null when never used). */
  daysSinceUse: number | null;
  /** Real uses (download/copy events, web UI and CLI alike) — the same writes behind the "N uses" tally. */
  useCount: number;
  /** Every recorded event, of any type. */
  eventCount: number;
  /** The "arrival" moment the age guard measures: the later of creation and the most recent adoption —
   *  re-adopting an old skill into a new repo restarts its chance to prove itself. */
  anchorAt: string;
  /** Whole days since `anchorAt`. */
  ageDays: number;
  /** The window this skill was actually judged against — the constant unless its cadence derived a
   *  longer one (D44). Surfaced so a badge can say "no use in 90 days" honestly. */
  windowDays: number;
}

const DAY_MS = 86_400_000;
/** Whole days between two instants (never negative — a clock-skewed future timestamp reads as "now"). */
function daysBetween(from: string, now: Date): number {
  const t = Date.parse(from);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / DAY_MS));
}

/** Later of two ISO instants; tolerates an unparseable/absent candidate. */
function laterOf(a: string, b: string | null | undefined): string {
  if (!b) return a;
  const tb = Date.parse(b);
  if (!Number.isFinite(tb)) return a;
  return tb > Date.parse(a) ? b : a;
}

export interface SkillUsageInput {
  skillId: string;
  /** When the skill was authored. */
  createdAt: string;
  /** Per-type event rollup for THIS skill (extra skills are ignored by the caller, not here). */
  events: Pick<SkillEventStat, "type" | "lastAt" | "count">[];
  /** Adoption timestamps for this skill (only the latest matters). */
  adoptedAt?: string[];
  /** Declared cadence in days ("this is a quarterly checklist"). Overrides the observed cadence in
   *  {@link dormancyWindowFor}. Absent for every skill until the library carries the field. */
  cadenceDays?: number | null;
  /**
   * Has this ORG's skill-event pathway ever emitted anything at all? False ⇒ a zero-event skill is
   * `unmeasured`, not `unused` (D24). Defaults to true so a single-skill call keeps its old meaning;
   * {@link skillUsageMap} derives it once from the whole org's rows, which is the only level at which
   * it can be answered honestly.
   */
  orgHasTelemetry?: boolean;
}

/**
 * The verdict for one skill. `lastUsedAt` ranks download > sync, but only a REAL use (`download` — a
 * human copy or download, from the web UI or a CLI) can make a skill `active`: `sync` is a background
 * pull the CLI emits on every run (including its drift report), so counting it would make every skill in
 * a repo with a scheduled sync look alive forever — exactly the false "everything is fine" the dormancy
 * view exists to break. Rules in order:
 *   1. really used inside the window     → active
 *   2. never used and younger than it    → new        (the age guard)
 *   3. really used, but not since then   → abandoned  ┐
 *   4. never used, org pathway is silent → unmeasured ├ all three badge as `dormant` (D24)
 *   5. never used, pathway works         → unused     ┘
 * Rule 1 runs first so a brand-new skill that is already being used reads as `active`, and rule 2 can
 * only claim a skill with no real use at all. Only rule 3 yields a prune candidate.
 *
 * The window in rules 1 and 2 is the SAME number (`windowDays`), derived once — that coupling is what
 * stops a skill from being simultaneously "new" (young) and "dormant" (silent).
 */
export function skillUsage(input: SkillUsageInput, now: Date = new Date()): SkillUsage {
  const byType = new Map<string, { lastAt: string; count: number }>();
  for (const e of input.events) {
    const prev = byType.get(e.type);
    // Defensive fold: the DB rollup is already one row per (skill,type), but a caller-built list may not be.
    byType.set(e.type, { lastAt: laterOf(prev?.lastAt ?? e.lastAt, e.lastAt), count: (prev?.count ?? 0) + e.count });
  }
  const download = byType.get("download");
  const sync = byType.get("sync");
  const picked: [SkillUsage["lastUsedType"], { lastAt: string; count: number } | undefined] = download
    ? ["download", download]
    : sync
      ? ["sync", sync]
      : [null, undefined];
  const lastUsedAt = picked[1]?.lastAt ?? null;
  const daysSinceUse = lastUsedAt ? daysBetween(lastUsedAt, now) : null;
  // The activity clock ignores `sync` (see the doc comment): a pull is not a use.
  const daysSinceRealUse = download ? daysBetween(download.lastAt, now) : null;

  let anchorAt = input.createdAt;
  for (const a of input.adoptedAt ?? []) anchorAt = laterOf(anchorAt, a);
  const ageDays = daysBetween(anchorAt, now);

  const useCount = download?.count ?? 0;
  const windowDays = dormancyWindowFor({ cadenceDays: input.cadenceDays, ageDays, useCount });

  const state: SkillUsageState =
    daysSinceRealUse !== null && daysSinceRealUse <= windowDays
      ? "active"
      : !download && ageDays < windowDays
        ? "new"
        : download
          ? "abandoned"
          : // `unmeasured` needs silence at BOTH levels: this skill emitted nothing of any type (a `sync`
            // proves the pathway reaches it, even though a pull is not a use) and neither did the org.
            input.orgHasTelemetry === false && byType.size === 0
            ? "unmeasured"
            : "unused";

  return {
    skillId: input.skillId,
    state,
    verdict: verdictOfState(state),
    lastUsedAt,
    lastUsedType: picked[0],
    daysSinceUse,
    useCount,
    eventCount: Array.from(byType.values()).reduce((n, v) => n + v.count, 0),
    anchorAt,
    ageDays,
    windowDays,
  };
}

/** Fold a whole org's fetched rows into a verdict per skill id. Pure — the DB read is the caller's. */
export function skillUsageMap(rows: SkillUsageRows, now: Date = new Date()): Record<string, SkillUsage> {
  const events = new Map<string, SkillEventStat[]>();
  for (const e of rows.events) {
    const list = events.get(e.skillId) ?? [];
    list.push(e);
    events.set(e.skillId, list);
  }
  const adoptions = new Map<string, string[]>();
  for (const a of rows.adoptions) {
    const list = adoptions.get(a.skillId) ?? [];
    list.push(a.adoptedAt);
    adoptions.set(a.skillId, list);
  }
  // The org-wide instrumentation fact behind `unmeasured` (D24): if not one event of any type exists
  // for the whole library, the pathway is silent and NOTHING is known about any skill's use. One row
  // anywhere proves the pathway works, so a zero-event skill in that org is genuinely `unused`.
  const orgHasTelemetry = rows.events.length > 0;
  const out: Record<string, SkillUsage> = {};
  for (const s of rows.skills) {
    out[s.id] = skillUsage(
      {
        skillId: s.id,
        createdAt: s.createdAt,
        events: events.get(s.id) ?? [],
        adoptedAt: adoptions.get(s.id) ?? [],
        orgHasTelemetry,
      },
      now,
    );
  }
  return out;
}

export interface UsageSummary {
  total: number;
  new: number;
  active: number;
  /** `abandoned + unused + unmeasured` — what the badge shows. */
  dormant: number;
  /** The prune-candidate count. Never `dormant`: see {@link isPruneCandidate}. */
  abandoned: number;
  unused: number;
  unmeasured: number;
}

/** Fleet-level counts for a header line ("3 dormant of 12"), split so a prune prompt can quote the
 *  `abandoned` count rather than the merged `dormant` one. */
export function usageSummary(map: Record<string, SkillUsage>): UsageSummary {
  const out: UsageSummary = { total: 0, new: 0, active: 0, dormant: 0, abandoned: 0, unused: 0, unmeasured: 0 };
  for (const u of Object.values(map)) {
    out.total += 1;
    out[u.verdict] += 1;
    if (u.state === "abandoned" || u.state === "unused" || u.state === "unmeasured") out[u.state] += 1;
  }
  return out;
}

/** Human label for a verdict — single-sourced so the badge and any brief agree. */
export function usageVerdictLabel(v: SkillUsageVerdict): string {
  return v === "new" ? "New" : v === "active" ? "Active" : "Dormant";
}

/** Human label for the finer state — what a prune prompt or a library brief must say instead of
 *  "dormant", because these three call for three different actions. */
export function usageStateLabel(s: SkillUsageState): string {
  switch (s) {
    case "new":
      return "New";
    case "active":
      return "Active";
    case "abandoned":
      return "Tried, then abandoned";
    case "unused":
      return "Never used";
    case "unmeasured":
      return "Never measured";
  }
}
