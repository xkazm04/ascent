// The Follow-ups ledger's client-side model — pure. Flattens the org backlog read into rows, and
// carries the filter / sort / selection arithmetic every variant shares, so a variant is only a
// layout over the same rows and the same batch summary.

import type { BacklogItem, OrgBacklog } from "@/lib/db/org-insights";
import type { FollowUpItem } from "@/lib/org/followups";
import { DIMENSION_SHORT } from "@/lib/ui";
import type { DimensionId } from "@/lib/types";

export type FollowUpStatus = "open" | "in_progress" | "done" | "dismissed";

/** One ledger row: the prompt's FollowUpItem plus the state the ledger renders. */
export interface FollowUpRow extends FollowUpItem {
  repoName: string;
  status: FollowUpStatus;
  /** ISO of the latest timeline event (or the row's creation). */
  lastActivityAt: string;
  /** The level closing this gap crosses into, or null. */
  unlocks: string | null;
  assigneeLogin: string | null;
}

/** Flatten the backlog's owner groups into one row per recommendation. Pure. Every item appears in
 *  exactly one owner group, so no dedup is needed; the order is by projected points desc. */
export function rowsFromBacklog(b: OrgBacklog): FollowUpRow[] {
  const rows: FollowUpRow[] = [];
  for (const g of b.byOwner) for (const it of g.items) rows.push(toRow(it));
  return sortByValue(rows);
}

function toRow(it: BacklogItem): FollowUpRow {
  return {
    id: it.id,
    repo: it.repo,
    repoName: it.repoName,
    title: it.title,
    dimId: it.dimId,
    dimLabel: DIMENSION_SHORT[it.dimId as DimensionId] ?? it.dimLabel,
    impact: it.impact,
    effort: it.effort,
    rationale: it.rationale,
    explore: it.explore,
    projectedPoints: it.projectedPoints,
    status: (["open", "in_progress", "done", "dismissed"].includes(it.status) ? it.status : "open") as FollowUpStatus,
    lastActivityAt: it.lastActivityAt,
    unlocks: it.unlocks,
    assigneeLogin: it.assigneeLogin,
  };
}

const IMPACT_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/** Biggest projected gain first; ties by impact, then effort (cheapest first), then title. */
export function sortByValue(rows: FollowUpRow[]): FollowUpRow[] {
  return [...rows].sort(
    (a, b) =>
      (b.projectedPoints ?? -1) - (a.projectedPoints ?? -1) ||
      (IMPACT_RANK[a.impact] ?? 9) - (IMPACT_RANK[b.impact] ?? 9) ||
      (IMPACT_RANK[a.effort] ?? 9) - (IMPACT_RANK[b.effort] ?? 9) ||
      a.title.localeCompare(b.title),
  );
}

export interface FollowUpFilters {
  repos: Set<string>;
  dims: Set<string>;
  impacts: Set<string>;
  /** Empty = the working set (open + in_progress). "done"/"dismissed" reveal the archive. */
  statuses: Set<string>;
  query: string;
  /** Only dimensions with an active follow-up in ≥ half the fleet (see dimensionSpread). */
  orgWide: boolean;
}

export const emptyFilters = (): FollowUpFilters => ({ repos: new Set(), dims: new Set(), impacts: new Set(), statuses: new Set(), query: "", orgWide: false });

export const ACTIVE_STATUSES: ReadonlySet<string> = new Set(["open", "in_progress"]);

export function applyFilters(rows: FollowUpRow[], f: FollowUpFilters, spread?: Map<string, DimensionSpread>): FollowUpRow[] {
  const q = f.query.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.orgWide && !spread?.get(r.dimId)?.orgWide) return false;
    if (f.statuses.size ? !f.statuses.has(r.status) : !ACTIVE_STATUSES.has(r.status)) return false;
    if (f.repos.size && !f.repos.has(r.repo)) return false;
    if (f.dims.size && !f.dims.has(r.dimId)) return false;
    if (f.impacts.size && !f.impacts.has(r.impact)) return false;
    if (q && !`${r.title} ${r.rationale} ${r.repo} ${r.dimLabel}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export function filtersActive(f: FollowUpFilters): boolean {
  return f.repos.size > 0 || f.dims.size > 0 || f.impacts.size > 0 || f.statuses.size > 0 || f.query.trim().length > 0 || f.orgWide;
}

/** The batch summary the bulk bar / rail renders. */
export function summarizeSelection(rows: FollowUpRow[], selected: ReadonlySet<string>) {
  const picked = rows.filter((r) => selected.has(r.id));
  const repos = new Set(picked.map((r) => r.repo));
  const points = picked.reduce((s, r) => s + (r.projectedPoints ?? 0), 0);
  return { picked, count: picked.length, repos: repos.size, points };
}

export const STATUS_LABEL: Record<FollowUpStatus, string> = {
  open: "open",
  in_progress: "handed off",
  done: "resolved",
  dismissed: "dismissed",
};

// ─── Ported from the Plan tab's gap decomposition ─────────────────────────────────────────────────
// The one Plan idea that is ABOUT mass scanning: a gap present in at least half the fleet is an ORG
// problem — fix it once, as a practice, copying whoever already nails it — not N repo tickets. In a
// 10-20-items-per-repo world that distinction decides what a batch should be, so it rides on the
// row: `orgWide` = the dimension has an open follow-up in ≥ half the scanned repos.

export interface DimensionSpread {
  dimId: string;
  /** Distinct repos with an ACTIVE follow-up on this dimension. */
  repos: number;
  /** Distinct repos in the ledger at all (the denominator). */
  of: number;
  orgWide: boolean;
}

/** Per-dimension spread over the ACTIVE rows. Pure. */
export function dimensionSpread(rows: FollowUpRow[]): Map<string, DimensionSpread> {
  const allRepos = new Set(rows.map((r) => r.repo));
  const byDim = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!ACTIVE_STATUSES.has(r.status)) continue;
    const s = byDim.get(r.dimId) ?? new Set<string>();
    s.add(r.repo);
    byDim.set(r.dimId, s);
  }
  const of = allRepos.size;
  const out = new Map<string, DimensionSpread>();
  for (const [dimId, repos] of byDim) {
    out.set(dimId, { dimId, repos: repos.size, of, orgWide: of >= 2 && repos.size * 2 >= of });
  }
  return out;
}

// ─── Ported from the Backlog tab's bulk bar ───────────────────────────────────────────────────────
// One status write per selected row, bounded concurrency, then ONE refresh — resolve/dismiss by hand
// in bulk, because a mass scan leaves more rows than anyone closes one at a time.
export async function patchStatuses(ids: readonly string[], status: FollowUpStatus, concurrency = 4): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  const queue = [...ids];
  const worker = async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      try {
        const r = await fetch(`/api/recommendations/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
        if (r.ok) ok += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  return { ok, failed };
}
