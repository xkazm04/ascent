// Pure search/filter model for the org backlog panel (G7-12). No JSX, no hooks — so the composition
// rules below (especially the one with the `includeClosed` toggle) are unit-testable without a DOM.
//
// THE COMPOSITION RULE THAT MATTERS: filtering is a CLIENT-side narrowing of whatever the server
// returned; it is NOT a second fetch scope. `getOrgBacklog(..., { includeClosed })` decides whether
// done/dismissed rows are in the payload at all. So a status chip for a CLOSED status can only ever
// match if the closed rows were fetched — which is why `filterWantsClosed` exists and why the panel
// forces the toggle on when such a chip is picked. Building the filter "around" the toggle (e.g. by
// fetching closed rows whenever a search is typed) would fight the recovery view that shipped with the
// undo bar; this builds ON it.

import type { BacklogItem, OrgBacklog } from "@/lib/db";

/** Sentinel owner value meaning "no assignee" — distinct from `null`, which means "any owner". */
export const UNASSIGNED = "__unassigned";

/** The statuses that are absent from the payload unless `includeClosed` is on. */
export const CLOSED_STATUSES: readonly string[] = ["done", "dismissed"];

/** Every status a chip can select, in display order. */
export const FILTERABLE_STATUSES: readonly string[] = ["open", "in_progress", "done", "dismissed"];

export interface BacklogFilter {
  /** Free-text query. Whitespace-separated terms are AND-ed (all must match). */
  q: string;
  /** Selected statuses; empty means "every status present in the payload". */
  statuses: readonly string[];
  /** An owner login, {@link UNASSIGNED}, or null for "any owner". */
  owner: string | null;
}

export const EMPTY_BACKLOG_FILTER: BacklogFilter = { q: "", statuses: [], owner: null };

export function filterIsActive(f: BacklogFilter): boolean {
  return f.q.trim() !== "" || f.statuses.length > 0 || f.owner != null;
}

/**
 * True when the filter asks for done/dismissed rows. The default fetch does not carry them, so a chip
 * alone would match nothing and read as "search is broken". The panel turns `includeClosed` on when
 * this is true — the filter composes with the toggle instead of duplicating it.
 */
export function filterWantsClosed(f: BacklogFilter): boolean {
  return f.statuses.some((s) => CLOSED_STATUSES.includes(s));
}

/**
 * The searchable text of one row. Deliberately the fields the row RENDERS (title, repo, dimension,
 * impact/effort, owner) plus the rationale that its expandable area shows — searching text a user
 * can't see anywhere on the row would make a hit look like a false positive.
 */
function haystack(item: BacklogItem): string {
  return [
    item.title,
    item.repo,
    item.dimId,
    item.dimLabel,
    item.impact,
    item.effort,
    item.assigneeLogin ?? "",
    item.rationale,
  ]
    .join(" ")
    .toLowerCase();
}

export function matchesBacklogFilter(item: BacklogItem, f: BacklogFilter): boolean {
  if (f.statuses.length > 0 && !f.statuses.includes(item.status)) return false;
  if (f.owner != null) {
    const want = f.owner === UNASSIGNED ? null : f.owner;
    if ((item.assigneeLogin ?? null) !== want) return false;
  }
  const terms = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay = haystack(item);
  return terms.every((t) => hay.includes(t));
}

/**
 * Narrow the grouped lists to the matching rows, dropping groups that empty out.
 *
 * The HEADLINE COUNTS are deliberately left untouched: exactly like `includeClosed`, they always
 * describe the org's active working backlog, so the summary strip can't swing as a user types. The
 * "how many are on screen" number is reported separately by {@link backlogItemCount}.
 */
export function filterBacklog(b: OrgBacklog, f: BacklogFilter): OrgBacklog {
  if (!filterIsActive(f)) return b;
  const match = (i: BacklogItem) => matchesBacklogFilter(i, f);
  return {
    ...b,
    byOwner: b.byOwner.map((g) => ({ ...g, items: g.items.filter(match) })).filter((g) => g.items.length > 0),
    byDue: b.byDue.map((g) => ({ ...g, items: g.items.filter(match) })).filter((g) => g.items.length > 0),
  };
}

/** Rows currently in the grouped lists. `byOwner` is the authoritative flat set (the "points" view is
 *  built from it, and `byDue` carries the same rows re-bucketed). */
export function backlogItemCount(b: OrgBacklog): number {
  return b.byOwner.reduce((n, g) => n + g.items.length, 0);
}

/** Every id currently in the grouped lists — the "select all shown" source, so selection can never
 *  reach a row the active filter has hidden. */
export function backlogItemIds(b: OrgBacklog): string[] {
  return b.byOwner.flatMap((g) => g.items.map((i) => i.id));
}

/**
 * Owner-filter options sourced from the rows actually present, not from the org's whole contributor
 * roster (`backlog.assignees`) — an option that can only ever yield an empty list is a dead end.
 */
export function backlogOwnerOptions(b: OrgBacklog): { logins: string[]; hasUnassigned: boolean } {
  const logins = new Set<string>();
  let hasUnassigned = false;
  for (const g of b.byOwner) {
    if (g.items.length === 0) continue;
    if (g.login) logins.add(g.login);
    else hasUnassigned = true;
  }
  return { logins: [...logins].sort((a, b2) => a.localeCompare(b2)), hasUnassigned };
}
