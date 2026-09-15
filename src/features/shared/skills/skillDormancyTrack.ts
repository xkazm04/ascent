// The Skills tab's use-over-time track — the second half of skillLifecycleViz, split out to keep both
// files under the 200-LOC features cap. It imports the state vocabulary from that module; the
// dependency runs one way, so there is no barrel and no cycle.
//
// The lane is where "no use was recorded in this window" and "this org has never measured a skill
// event at all" stop being the same amber word: the first is a VOID (the dotted ground shows
// through), the second is a HATCH.

import type { TrackRow, TrackSegment } from "@/components/org/viz";
import type { SkillUsage } from "@/lib/org/skill-usage";
import type { SkillRow } from "@/lib/db";
import { rankSkills, usageDetail, usageVizState } from "@/features/shared/skills/skillLifecycleViz";

// ── Use over time ────────────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** Epoch ms at the start of the UTC day after `now` — the track's right edge. Day-rounded so the
 *  geometry a server render produces and the one hydration produces are the same picture. */
export function trackEnd(now: number): number {
  return (Math.floor(now / DAY_MS) + 1) * DAY_MS;
}

export const isoDay = (t: number): string => new Date(t).toISOString().slice(0, 10);

export interface Track {
  rows: TrackRow[];
  start: number;
  end: number;
  ticks: { at: number; label: string }[];
}

/**
 * The instant these verdicts were computed at, recovered from the rows themselves: every `SkillUsage`
 * carries an anchor and the whole days since it, so `anchor + ageDays` is the server's own clock at
 * day resolution. Derived rather than read from `Date.now()` on purpose — a chart that calls the
 * clock during render draws one picture on the server and a different one at hydration, and the
 * right edge of this track is exactly the instant the dormancy window was judged against.
 */
export function observedAt(usage: Record<string, SkillUsage>): number | null {
  let latest: number | null = null;
  for (const u of Object.values(usage)) {
    const anchor = Date.parse(u.anchorAt);
    if (Number.isFinite(anchor)) latest = Math.max(latest ?? 0, anchor + u.ageDays * DAY_MS);
    const last = u.lastUsedAt ? Date.parse(u.lastUsedAt) : NaN;
    if (Number.isFinite(last)) latest = Math.max(latest ?? 0, last);
  }
  return latest;
}

/**
 * One lane per skill over the library's own life. Each lane is at most two segments:
 *   [arrival … last use]  — MEASURED where a real use was observed, DECLARED where the only event was
 *                           a `sync` (a background pull the CLI emits; it is not a use).
 *   [last use … now]      — MISSING (a void: the dotted ground shows through) where the org's pathway
 *                           works and recorded nothing, NOT-JUDGED (hatched) where the pathway itself
 *                           has never emitted anything. "No use in this window" and "we have never
 *                           measured this skill" are different claims and now look different.
 */
export function dormancyLanes(skills: SkillRow[], usage: Record<string, SkillUsage>, now?: number): Track {
  const end = trackEnd(now ?? observedAt(usage) ?? 0);
  const rows: TrackRow[] = [];
  let earliest = end;

  for (const s of rankSkills(skills)) {
    const u = usage[s.id];
    if (!u) continue;
    const anchor = Date.parse(u.anchorAt);
    if (!Number.isFinite(anchor)) continue;
    earliest = Math.min(earliest, anchor);

    const lastRaw = u.lastUsedAt ? Date.parse(u.lastUsedAt) : NaN;
    const last = Number.isFinite(lastRaw) ? Math.min(Math.max(lastRaw, anchor), end) : null;
    const segments: TrackSegment[] = [];
    if (last !== null) {
      const real = u.lastUsedType !== "sync";
      segments.push({
        from: anchor,
        to: last,
        state: real ? "measured" : "declared",
        label: real ? `${s.name} — ${usageDetail(u)}` : `${s.name} — synced, never used`,
      });
    }
    const quiet = usageVizState(u) === "not-judged" ? "not-judged" : "missing";
    segments.push({
      from: last ?? anchor,
      to: end,
      state: quiet,
      label:
        quiet === "not-judged"
          ? `${s.name} — no skill events recorded in this org`
          : `${s.name} — no use recorded since ${isoDay(last ?? anchor)}`,
    });
    rows.push({ id: s.id, label: s.name, segments });
  }

  const start = Math.min(earliest, end - DAY_MS);
  return { rows, start, end, ticks: [{ at: start, label: isoDay(start) }, { at: end, label: "now" }] };
}
