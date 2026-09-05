// #16 — the pure view model behind Standing › Passports › Controls. No React, no fetch: turning rows
// into columns is the part worth testing, and it is the part that decides whether an absent
// measurement can ever be drawn as a green cell.

import type { CheckLevel } from "@/lib/standard/check-ids";
import { parseCheckId } from "@/lib/standard/check-ids";

/** One repo's row as the matrix API returns it (see /api/report/conformance/matrix). */
export interface ControlMatrixRowView {
  repoFullName: string;
  reportedAt: string;
  summaryOnly: boolean;
  specVersion: string | null;
  checks: { check: string; family: string; subject: string | null; level: CheckLevel; since: string | null; message: string }[];
}

export interface ControlColumn {
  /** The family, or `family.subject` when expanded. */
  key: string;
  label: string;
  family: string;
  /** The check ids this column folds together. */
  members: string[];
}

export interface ControlCellState {
  level: CheckLevel;
  since: string | null;
  message: string;
  /** How many of the column's checks the repo reported at this level (>1 when a family is folded). */
  count: number;
}

/** Rank used when a COLLAPSED family cell has to speak for several checks at once. Worst wins: a
 *  family is only green when nothing inside it is worse, and `unchecked` outranks `pass` so an
 *  unmeasured clause is never hidden behind a measured sibling. */
const RANK: Record<CheckLevel, number> = { fail: 3, warn: 2, unchecked: 1, pass: 0 };

/** The columns for a set of rows: one per family when collapsed, one per check when expanded. */
export function columnsFor(rows: ControlMatrixRowView[], expanded: Set<string>): ControlColumn[] {
  const byFamily = new Map<string, Set<string>>();
  for (const r of rows)
    for (const c of r.checks) {
      const family = c.family || parseCheckId(c.check).family;
      (byFamily.get(family) ?? byFamily.set(family, new Set()).get(family)!).add(c.check);
    }
  const out: ControlColumn[] = [];
  for (const [family, checks] of [...byFamily].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!expanded.has(family)) {
      out.push({ key: family, label: family, family, members: [...checks].sort() });
      continue;
    }
    for (const check of [...checks].sort())
      out.push({ key: check, label: check.slice(family.length + 1) || family, family, members: [check] });
  }
  return out;
}

/**
 * The cell for one repo × column, or NULL when this repo reported none of the column's checks.
 *
 * Null is the load-bearing return: the grid renders it as an `unchecked`-styled dash, because a repo
 * that never reported a clause has not passed it. Returning a synthesized `pass` here — or an empty
 * cell that reads as blank-therefore-fine — is the exact failure this whole item exists to remove.
 */
export function cellFor(row: ControlMatrixRowView, column: ControlColumn): ControlCellState | null {
  const hits = row.checks.filter((c) => column.members.includes(c.check));
  if (hits.length === 0) return null;
  const worst = hits.reduce((a, b) => (RANK[b.level] > RANK[a.level] ? b : a));
  return {
    level: worst.level,
    // A folded family's "since" is only meaningful when ONE check speaks for it; otherwise the dates
    // belong to different clauses and averaging them would invent a fact.
    since: hits.length === 1 ? worst.since : null,
    message: worst.message,
    count: hits.length,
  };
}

/** Fleet counts per column, over the repos that reported it — never over all repos. */
export function columnTotals(rows: ControlMatrixRowView[], column: ControlColumn) {
  const totals = { pass: 0, warn: 0, fail: 0, unchecked: 0, reporting: 0, silent: 0 };
  for (const r of rows) {
    const cell = cellFor(r, column);
    if (!cell) {
      totals.silent += 1;
      continue;
    }
    totals[cell.level] += 1;
    totals.reporting += 1;
  }
  return totals;
}

/** A short, human "since" — the date alone. Null stays null and is rendered as an em dash. */
export function sinceLabel(since: string | null): string | null {
  return since ? since.slice(0, 10) : null;
}
