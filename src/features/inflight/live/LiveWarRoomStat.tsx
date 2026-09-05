"use client";

import { scoreHex } from "@/lib/ui";
import { POSTURE_HEX } from "@/components/org/shared/liveWarRoomShared";
import { HEADLINE_SCALE, type WallScale } from "./warRoomScale";
import { headlineAnnouncement } from "./warRoomAnnounce";
import { useSettledAnnouncement } from "./useLiveWarRoomStat";
import { Sparkline, StatCell } from "./LiveWarRoomStatParts";

/**
 * The wall's headline metrics as ONE command strip (2×2 on mobile, a divided 1×4 band on lg) instead
 * of four floating cards — less chrome, less scroll, reads as a single instrument. Each metric keeps
 * the count-up tween; the campaign deltas and the trend spark give the numbers a direction, not just
 * a level.
 */
export function HeadlineStrip({
  stats,
  deltas = null,
  trend,
  scale = "panel",
  running = false,
}: {
  stats: {
    avgOverall: number | null;
    avgAdoption: number | null;
    avgRigor: number | null;
    aiNative: number;
    scored: number;
    total: number;
  };
  deltas?: { overall: number; adoption: number; rigor: number } | null;
  trend?: { date: string; avg: number }[];
  /** "wall" = the surface has DECLARED itself a wall (TV mode / read-only share screen). See
   *  warRoomScale.ts for why this is a mode and not a breakpoint. */
  scale?: WallScale;
  /** A scan is in flight — suppresses this strip's announcer so the header's coalesced progress
   *  count stays the single live voice for the run. */
  running?: boolean;
}) {
  const spark = (trend ?? []).slice(-12).map((p) => p.avg);
  const sz = HEADLINE_SCALE[scale];
  const announcement = useSettledAnnouncement(headlineAnnouncement(stats, deltas), running);
  return (
    <section
      aria-label="Fleet headline metrics"
      className="mt-6 grid grid-cols-2 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40 lg:grid-cols-4"
    >
      <StatCell
        label="Org maturity"
        value={stats.avgOverall}
        color={stats.avgOverall == null ? undefined : scoreHex(stats.avgOverall)}
        delta={deltas?.overall}
        scale={scale}
      >
        {spark.length >= 2 && <Sparkline points={spark} box={sz.spark} />}
      </StatCell>
      <StatCell
        label="AI Adoption"
        value={stats.avgAdoption}
        color={stats.avgAdoption == null ? undefined : scoreHex(stats.avgAdoption)}
        delta={deltas?.adoption}
        scale={scale}
        className="border-l border-slate-800"
      />
      <StatCell
        label="Engineering Rigor"
        value={stats.avgRigor}
        color={stats.avgRigor == null ? undefined : scoreHex(stats.avgRigor)}
        delta={deltas?.rigor}
        scale={scale}
        className="border-t border-slate-800 lg:border-l lg:border-t-0"
      />
      {/* live-war-room 07-16 #4: the old `${n}/${stats.scored || stats.total}` silently swapped the
          denominator from "repos scored" to "whole fleet" when nothing was scanned yet — and hid the
          clarifying sub line in exactly that case, so "0/40" (fleet size) read like "0 of 40 scored"
          on a projected wall. Pre-scan the tile now shows an honest em-dash with a named empty state;
          the denominator is ALWAYS "repos scored" and its sub label always renders. */}
      <StatCell
        label="AI-Native repos"
        value={stats.aiNative}
        color={stats.aiNative > 0 ? POSTURE_HEX["ai-native"] : undefined}
        render={(n) => (stats.scored > 0 ? `${n}/${stats.scored}` : "—")}
        sub={stats.scored > 0 ? `of ${stats.scored} scored` : "no scans yet"}
        scale={scale}
        className="border-l border-t border-slate-800 lg:border-t-0"
      />
      {/* G6-07: the settled voice of the four tiles. Empty until the numbers actually move and the
          run finishes — see useSettledAnnouncement. */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </section>
  );
}
