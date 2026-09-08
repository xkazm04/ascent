// The version timeline's geometry (#36): a registry skill's history as lanes over one window.
//
// The trace's subject is VERSIONS AND COMMITS, not invocations — a registry skill's git history plus
// the lessons recorded against each version. Three facts about the READ are drawn rather than
// captioned, because each of them is an absence a table would render as an em dash:
//   · a commit whose version could not be resolved → NOT-JUDGED (hatched). Missing evidence about the
//     read, never the neighbouring version carried backwards.
//   · a lesson whose declared version matches no resolved commit → DECLARED (dashed outline). The
//     lesson claims a version; nothing in the window confirms which commit shipped it.
//   · history older than the read budget → MISSING (a void at the left edge). Not "no history".
//
// Pure: no JSX, no hooks.

import type { TrackRow, TrackSegment, VizState } from "@/components/org/viz";
import type { TraceGroup } from "@/lib/registry/trace";
import { traceGroupLabel } from "@/lib/registry/trace";

/** The sentence the void at the left edge carries — it rides as the segment label, so it reaches a
 *  reader through the track's `sr-only` table instead of sitting under the timeline as prose. */
export const TRUNCATED_LABEL = "older commits exist beyond the read budget";

/** A version shipped in one commit is a real instant, and an instant has no width to draw. The lane
 *  is widened to this share of the window so the mark is visible; the true date rides in the label,
 *  so the picture rounds and the text does not. */
const MIN_SPAN_SHARE = 0.02;

const day = (t: number) => new Date(t).toISOString().slice(0, 10);

function groupState(g: TraceGroup): VizState {
  if (g.unplaced) return "declared";
  return g.version === null ? "not-judged" : "measured";
}

/** Every instant a group can honestly claim: the commits it holds, plus — for the unplaced group,
 *  which holds no commit at all — the days its lessons were learned on. */
function groupTimes(g: TraceGroup): number[] {
  const times = g.entries.map((e) => Date.parse(e.authoredAt));
  if (times.length === 0) for (const l of g.lessons) times.push(Date.parse(l.learnedOn ?? ""));
  return times.filter((t) => Number.isFinite(t));
}

export interface TraceTrack {
  rows: TrackRow[];
  start: number;
  end: number;
  ticks: { at: number; label: string }[];
}

/** Null when no group carries a single readable instant — there is no window, so there is no track,
 *  and the caller renders the grouped list alone rather than an empty axis. */
export function traceLanes(groups: TraceGroup[], truncated: boolean): TraceTrack | null {
  const spans = groups
    .map((g) => ({ g, times: groupTimes(g) }))
    .filter((s) => s.times.length > 0)
    .map((s) => ({ g: s.g, lo: Math.min(...s.times), hi: Math.max(...s.times) }));
  if (spans.length === 0) return null;

  const oldest = Math.min(...spans.map((s) => s.lo));
  const newest = Math.max(...spans.map((s) => s.hi));
  // A truncated history gets real room at the left edge for the void to occupy; an untruncated one
  // still needs a non-degenerate window when every commit landed on the same day.
  const raw = Math.max(newest - oldest, 1);
  const pad = truncated ? Math.max(raw * 0.25, 86_400_000) : Math.max(raw * 0.02, 3_600_000);
  const start = oldest - pad;
  const end = newest + Math.max(raw * 0.02, 3_600_000);
  const minSpan = (end - start) * MIN_SPAN_SHARE;

  const rows: TrackRow[] = [];
  if (truncated) {
    rows.push({
      id: "truncated",
      label: "older",
      segments: [{ from: start, to: oldest, state: "missing", label: TRUNCATED_LABEL }],
    });
  }
  for (const s of spans) {
    const state = groupState(s.g);
    const label = traceGroupLabel(s.g);
    const to = Math.max(s.hi, s.lo + minSpan);
    const span: TrackSegment = {
      from: s.lo,
      to,
      state,
      label: `${label} — ${s.g.entries.length} commit${s.g.entries.length === 1 ? "" : "s"}, ${day(s.lo)}${
        s.hi > s.lo ? `–${day(s.hi)}` : ""
      }`,
    };
    // Index-keyed: two groups can share a label and a first instant, and a duplicate lane id would
    // silently drop one of them from the picture.
    rows.push({ id: `g${rows.length}`, label: s.g.version ? `v${s.g.version}` : label, segments: [span] });
  }

  return {
    rows,
    start,
    end,
    ticks: [
      { at: oldest, label: day(oldest) },
      { at: newest, label: day(newest) },
    ],
  };
}
