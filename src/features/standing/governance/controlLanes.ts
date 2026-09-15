// Lane shaping for the control ledger's `StateTrack` (org UX redesign §2 — draw it, don't narrate it).
//
// The ledger used to carry this sentence under a table:
//   "A dash under State means the control was not readable at the last observation — missing
//    evidence, not a finding."
// A dash cannot enforce that reading; a picture can. So the card now opens on a lane per control:
// a day we observed is a painted segment, a day we did NOT observe is a gap on the dotted ground,
// and a day whose every observation was `unmeasurable` is HATCHED with no value printed. Three
// different facts a single dash collapsed into one.
//
// PURE — no React, no I/O, so the bucketing and the run-merging are testable on their own and the
// card stays inside the 200-LOC cap this directory enforces.

import { controlLabel, controlOrder } from "@/lib/controls/catalog";
import { scoreHex } from "@/lib/ui";
import { VIZ_STATES } from "@/components/org/viz";
import type { TrackRow, TrackSegment, VizState } from "@/components/org/viz";
import type { ControlObservationRow, ControlState } from "@/lib/db/control-observations";

const DAY_MS = 86_400_000;

/** Lane budget. Eight lanes is what stays legible at the kit's 22px row pitch; the rest are COUNTED
 *  rather than dropped in silence — an omitted control must not look like an unobserved one. */
export const MAX_LANES = 8;

export interface ControlLanes {
  rows: TrackRow[];
  start: number;
  end: number;
  ticks: { at: number; label: string }[];
  /** Exactly the states this picture draws — the Legend renders these and nothing else. */
  states: VizState[];
  /** Controls that did not fit the lane budget. Stated by the card, never silently dropped. */
  omitted: number;
}

type Tally = Record<ControlState, number> & { total: number };
type Run = { from: number; to: number; state: VizState; color?: string; tally: Tally };

const dayStart = (iso: string): number => Date.parse(`${iso.slice(0, 10)}T00:00:00.000Z`);
const dayLabel = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const emptyTally = (): Tally => ({ total: 0, pass: 0, fail: 0, unmeasurable: 0 });

/**
 * A day's reading for one control across the fleet.
 *
 * `not-judged` when EVERY observation that day was unmeasurable — the kit then hatches the segment
 * and refuses to print a value, which is the encoding that replaces the dash sentence. Otherwise the
 * day is `measured` and coloured by the share of readable observations that were operating, so a bad
 * day is red because it was measured red, never because absence was painted as failure.
 */
function readDay(t: Tally): { state: VizState; color?: string } {
  const readable = t.pass + t.fail;
  if (readable === 0) return { state: "not-judged" };
  return { state: "measured", color: scoreHex(Math.round((t.pass / readable) * 100)) };
}

function segmentLabel(run: Run): string {
  const from = dayLabel(run.from);
  const to = dayLabel(run.to - DAY_MS);
  const span = from === to ? from : `${from} → ${to}`;
  const t = run.tally;
  return (
    `${span} · ${t.total} observation${t.total === 1 ? "" : "s"} · ` +
    `${t.pass} operating · ${t.fail} not operating · ${t.unmeasurable} not readable`
  );
}

/**
 * Bucket a flat observation feed into one lane per control, by UTC day.
 *
 * Adjacent days that read the same way are merged into ONE run, so a quarter of steady observation
 * is one bar rather than ninety — and the gaps that survive the merge are real gaps, which is the
 * whole point of the picture. Returns null when there is nothing to draw; the card then keeps its
 * empty state rather than plotting an empty window.
 */
export function controlLanes(
  observations: readonly ControlObservationRow[],
  maxLanes: number = MAX_LANES,
): ControlLanes | null {
  const byControl = new Map<string, Map<number, Tally>>();
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const o of observations) {
    const at = dayStart(o.occurredAt);
    if (!Number.isFinite(at)) continue;
    if (at < min) min = at;
    if (at > max) max = at;
    let days = byControl.get(o.controlId);
    if (!days) byControl.set(o.controlId, (days = new Map<number, Tally>()));
    const t = days.get(at) ?? emptyTally();
    t.total += 1;
    t[o.state] += 1;
    days.set(at, t);
  }
  if (byControl.size === 0 || !Number.isFinite(min) || !Number.isFinite(max)) return null;

  // Ranked by evidence volume so the lanes that survive the budget are the ones with something to
  // show, then re-sorted into CATALOGUE order — the order a reader should meet the controls in.
  const ranked = [...byControl.entries()]
    .map(([id, days]) => ({ id, days, n: [...days.values()].reduce((a, t) => a + t.total, 0) }))
    .sort((a, b) => b.n - a.n || controlOrder(a.id) - controlOrder(b.id));
  const kept = ranked.slice(0, Math.max(1, maxLanes)).sort((a, b) => controlOrder(a.id) - controlOrder(b.id));

  // `missing` is always present: the dotted ground under every lane IS the unobserved interval, and
  // a legend that omitted it would leave the gap unexplained — the exact failure this replaces.
  const present = new Set<VizState>(["missing"]);

  const rows: TrackRow[] = kept.map(({ id, days }) => {
    const runs: Run[] = [];
    for (const at of [...days.keys()].sort((a, b) => a - b)) {
      const tally = days.get(at) ?? emptyTally();
      const { state, color } = readDay(tally);
      present.add(state);
      const prev = runs[runs.length - 1];
      if (prev && prev.to === at && prev.state === state && prev.color === color) {
        prev.to = at + DAY_MS;
        prev.tally.total += tally.total;
        prev.tally.pass += tally.pass;
        prev.tally.fail += tally.fail;
        prev.tally.unmeasurable += tally.unmeasurable;
        continue;
      }
      runs.push({ from: at, to: at + DAY_MS, state, color, tally: { ...tally } });
    }
    const segments: TrackSegment[] = runs.map((r) => ({
      from: r.from,
      to: r.to,
      state: r.state,
      color: r.color,
      label: segmentLabel(r),
    }));
    return { id, label: controlLabel(id), segments };
  });

  const end = max + DAY_MS;
  // Three ticks at most: a compliance surface states dates, and two endpoints plus a midpoint is
  // enough to locate a gap without crowding a 320-unit track.
  const ticks =
    end - min > 2 * DAY_MS
      ? [
          { at: min, label: dayLabel(min) },
          { at: min + (end - min) / 2, label: dayLabel(min + (end - min) / 2) },
          { at: end, label: dayLabel(max) },
        ]
      : [{ at: min, label: dayLabel(min) }, { at: end, label: dayLabel(max) }];

  // Legend order is the vocabulary's own order, not the order a scan happened to meet the days in.
  const states = VIZ_STATES.filter((s) => present.has(s));
  return { rows, start: min, end, ticks, states, omitted: ranked.length - kept.length };
}
