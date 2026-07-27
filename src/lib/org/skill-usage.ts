// Skill dormancy (ported from the Personas skill-drift loop) — the other half of the Org Skills sync
// story: the CLI knows whether a skill's BODY drifted, this knows whether the skill is still USED. For
// each org skill we fold OrgSkillEvent (download | sync | invoke) + OrgSkillAdoption into a `lastUsedAt`
// and one of three verdicts: new | active | dormant.
//
// The age guard is the point: a library that just judged "no uses in 30 days ⇒ dead" would brand every
// freshly authored/adopted skill dormant on day one and teach the org to ignore the badge. A skill that
// arrived less than 30 days ago and has never been invoked is NEW (give it a chance), not dormant.
//
// Pure over fetched rows (getOrgSkillUsageRows) so the verdict is unit-testable without a DB.

// Types only: this module is imported by client components, so it must never pull a runtime `@/lib/db`
// symbol into the browser bundle. The reads live in skill-usage-load.ts.
import type { SkillEventStat, SkillUsageRows } from "@/lib/db";

/** `new` = arrived recently, never invoked. `active` = used inside the window. `dormant` = past the
 *  window with no use since (the prune candidate). */
export type SkillUsageVerdict = "new" | "active" | "dormant";

/** Days of silence before a skill counts as dormant — also the age below which a never-invoked skill is
 *  still "new" rather than dead. One constant so the two halves of the rule can't drift apart. */
export const DORMANCY_WINDOW_DAYS = 30;

export interface SkillUsage {
  skillId: string;
  verdict: SkillUsageVerdict;
  /** Latest use: the newest `invoke` when there is one, else the newest download/sync. Null = never used. */
  lastUsedAt: string | null;
  /** Which event kind `lastUsedAt` came from — an `invoke` is a real use, a `sync` is only a pull. */
  lastUsedType: "invoke" | "download" | "sync" | null;
  /** Whole days since `lastUsedAt` (null when never used). */
  daysSinceUse: number | null;
  invokeCount: number;
  /** Every recorded event, of any type. */
  eventCount: number;
  /** The "arrival" moment the age guard measures: the later of creation and the most recent adoption —
   *  re-adopting an old skill into a new repo restarts its chance to prove itself. */
  anchorAt: string;
  /** Whole days since `anchorAt`. */
  ageDays: number;
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
}

/**
 * The verdict for one skill. `lastUsedAt` ranks invoke > download > sync, but only a REAL use (invoke or
 * download) can make a skill `active`: `sync` is a background pull the CLI emits on every run (including
 * its drift report), so counting it would make every skill in a repo with a scheduled sync look alive
 * forever — exactly the false "everything is fine" the dormancy view exists to break. Rules in order:
 *   1. really used inside the window     → active
 *   2. never invoked and younger than it → new   (the age guard)
 *   3. otherwise                         → dormant
 * Rule 1 runs first so a brand-new skill that is already being invoked reads as `active`, and rule 2 can
 * only claim a skill with no recent real use at all.
 */
export function skillUsage(input: SkillUsageInput, now: Date = new Date()): SkillUsage {
  const byType = new Map<string, { lastAt: string; count: number }>();
  for (const e of input.events) {
    const prev = byType.get(e.type);
    // Defensive fold: the DB rollup is already one row per (skill,type), but a caller-built list may not be.
    byType.set(e.type, { lastAt: laterOf(prev?.lastAt ?? e.lastAt, e.lastAt), count: (prev?.count ?? 0) + e.count });
  }
  const invoke = byType.get("invoke");
  const download = byType.get("download");
  const sync = byType.get("sync");
  const picked: [SkillUsage["lastUsedType"], { lastAt: string; count: number } | undefined] = invoke
    ? ["invoke", invoke]
    : download
      ? ["download", download]
      : sync
        ? ["sync", sync]
        : [null, undefined];
  const lastUsedAt = picked[1]?.lastAt ?? null;
  const daysSinceUse = lastUsedAt ? daysBetween(lastUsedAt, now) : null;
  // The activity clock ignores `sync` (see the doc comment): a pull is not a use.
  const lastRealUse = invoke ?? download;
  const daysSinceRealUse = lastRealUse ? daysBetween(lastRealUse.lastAt, now) : null;

  let anchorAt = input.createdAt;
  for (const a of input.adoptedAt ?? []) anchorAt = laterOf(anchorAt, a);
  const ageDays = daysBetween(anchorAt, now);

  const verdict: SkillUsageVerdict =
    daysSinceRealUse !== null && daysSinceRealUse <= DORMANCY_WINDOW_DAYS
      ? "active"
      : !invoke && ageDays < DORMANCY_WINDOW_DAYS
        ? "new"
        : "dormant";

  return {
    skillId: input.skillId,
    verdict,
    lastUsedAt,
    lastUsedType: picked[0],
    daysSinceUse,
    invokeCount: invoke?.count ?? 0,
    eventCount: Array.from(byType.values()).reduce((n, v) => n + v.count, 0),
    anchorAt,
    ageDays,
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
  const out: Record<string, SkillUsage> = {};
  for (const s of rows.skills) {
    out[s.id] = skillUsage(
      { skillId: s.id, createdAt: s.createdAt, events: events.get(s.id) ?? [], adoptedAt: adoptions.get(s.id) ?? [] },
      now,
    );
  }
  return out;
}

/** Fleet-level counts for a header line ("3 dormant of 12"). */
export function usageSummary(map: Record<string, SkillUsage>): { total: number; new: number; active: number; dormant: number } {
  const out = { total: 0, new: 0, active: 0, dormant: 0 };
  for (const u of Object.values(map)) {
    out.total += 1;
    out[u.verdict] += 1;
  }
  return out;
}

/** Human label for a verdict — single-sourced so the badge and any brief agree. */
export function usageVerdictLabel(v: SkillUsageVerdict): string {
  return v === "new" ? "New" : v === "active" ? "Active" : "Dormant";
}
