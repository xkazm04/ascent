// Pure aligner for the fleet-evolution timetable: turns each repo's own scan history (its own
// timestamps) into a SHARED column grid — repos as rows, scan days as columns, each cell the repo's
// overall score that day. Kept pure (no React) so the alignment + delta rules are unit-testable.
// Day-bucketing (not exact instant) makes the grid robust to ms-level timestamp jitter across repos
// and merges a repo's multiple same-day scans to its latest that day.

import type { OrgRepoHistory, RepoTrajectoryPoint } from "@/lib/db/org-rollup";

export interface TimetableColumn {
  /** YYYY-MM-DD bucket key. */
  key: string;
  /** Short human label, e.g. "Jul 4". */
  label: string;
}

export interface TimetableRow {
  fullName: string;
  name: string;
  /** Overall score per column (aligned to `columns`); null when the repo had no scan that day. */
  cells: (number | null)[];
  /** Run-over-run change per column: this cell's score minus the repo's previous non-null cell — the
   *  per-scan efficiency differentiator. null for a null cell or the repo's first reading (no prior). */
  cellDeltas: (number | null)[];
  /** Most-recent non-null cell (the repo's current standing in the shown window). */
  latest: number | null;
  latestLevel: string | null;
  latestPosture: string | null;
  /** Oldest non-null cell in the window — the baseline for `delta`. */
  first: number | null;
  /** latest − first across the shown window (the repo's evolution), or null with <2 readings. */
  delta: number | null;
}

export interface FleetTimetable {
  columns: TimetableColumn[];
  rows: TimetableRow[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-07-04" → "Jul 4". Pure; falls back to the raw key on a malformed input. */
export function shortDate(dayKey: string): string {
  const [, m, d] = dayKey.split("-").map((n) => Number(n));
  if (!m || !d || m < 1 || m > 12) return dayKey;
  return `${MONTHS[m - 1]} ${d}`;
}

/**
 * Build the repos×days grid from per-repo histories (each `points` oldest→newest). Columns are the
 * distinct scan days across the whole fleet, most recent `maxCols` kept. Rows are sorted by current
 * standing (latest desc, name-tiebroken) so the strongest repos read first.
 */
export function buildFleetTimetable(histories: OrgRepoHistory[], maxCols = 8): FleetTimetable {
  const daySet = new Set<string>();
  for (const h of histories) for (const p of h.points) daySet.add(p.at.slice(0, 10));
  const shown = [...daySet].sort().slice(-maxCols);
  const columns: TimetableColumn[] = shown.map((key) => ({ key, label: shortDate(key) }));

  const rows: TimetableRow[] = histories.map((h) => {
    // points are oldest→newest, so the last write per day wins (a repo's latest scan that day).
    const byDay = new Map<string, RepoTrajectoryPoint>();
    for (const p of h.points) byDay.set(p.at.slice(0, 10), p);
    const cells = shown.map((d) => byDay.get(d)?.overall ?? null);
    // Per-cell change vs the repo's previous non-null reading (nulls don't reset or count).
    const cellDeltas: (number | null)[] = [];
    let prev: number | null = null;
    for (const v of cells) {
      if (v == null) cellDeltas.push(null);
      else {
        cellDeltas.push(prev == null ? null : v - prev);
        prev = v;
      }
    }
    const present = cells.filter((c): c is number => c != null);
    const first = present.length ? present[0]! : null;
    const latest = present.length ? present[present.length - 1]! : null;
    // Level/posture come from the latest shown-day point (for the row's current chip).
    let latestPt: RepoTrajectoryPoint | null = null;
    for (const p of h.points) if (shown.includes(p.at.slice(0, 10))) latestPt = p;
    return {
      fullName: h.fullName,
      name: h.name,
      cells,
      cellDeltas,
      latest,
      latestLevel: latestPt?.level ?? null,
      latestPosture: latestPt?.posture ?? null,
      first,
      // Evolution needs two readings; a single-scan repo has no baseline to move from.
      delta: present.length >= 2 && latest != null && first != null ? latest - first : null,
    };
  });

  rows.sort((a, b) => (b.latest ?? -1) - (a.latest ?? -1) || a.name.localeCompare(b.name));
  return { columns, rows };
}

/** Fleet-average overall per column (nulls skipped) — the timetable's footer row. */
export function columnAverages(t: FleetTimetable): (number | null)[] {
  return t.columns.map((_, i) => {
    const vals = t.rows.map((r) => r.cells[i]).filter((c): c is number => c != null);
    return vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
  });
}
