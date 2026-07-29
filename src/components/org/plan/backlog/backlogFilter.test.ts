// Pins the backlog's search/filter model (G7-12) — in particular the ONE rule that could silently
// break the recovery view that shipped with the undo bar: a closed-status chip is meaningless unless
// the fetch carried closed rows, so `filterWantsClosed` must be true for exactly those chips and the
// filtering itself must never touch the headline counts.

import { describe, it, expect } from "vitest";
import type { BacklogItem, OrgBacklog } from "@/lib/db";
import {
  EMPTY_BACKLOG_FILTER,
  UNASSIGNED,
  backlogItemCount,
  backlogItemIds,
  backlogOwnerOptions,
  filterBacklog,
  filterIsActive,
  filterWantsClosed,
  matchesBacklogFilter,
} from "./backlogFilter";

function item(over: Partial<BacklogItem> = {}): BacklogItem {
  return {
    id: "r1",
    title: "Add CI gate",
    dimId: "D2",
    dimLabel: "CI/CD",
    impact: "high",
    effort: "low",
    status: "open",
    assigneeLogin: null,
    targetDate: null,
    dueBucket: "no_date",
    dueInDays: null,
    overdue: false,
    repo: "acme/app",
    repoName: "app",
    lastActivityAt: "2026-01-01T00:00:00.000Z",
    projectedPoints: null,
    unlocks: null,
    rationale: "",
    explore: [],
    ...over,
  };
}

function backlog(items: BacklogItem[]): OrgBacklog {
  const byLogin = new Map<string | null, BacklogItem[]>();
  for (const i of items) {
    const k = i.assigneeLogin;
    byLogin.set(k, [...(byLogin.get(k) ?? []), i]);
  }
  return {
    org: "acme",
    includesClosed: false,
    repos: 1,
    tracked: items.length,
    active: items.length,
    assigned: 0,
    unassigned: 0,
    dueSoon: 0,
    open: 7,
    inProgress: 3,
    done: 5,
    dismissed: 2,
    overdue: 1,
    byOwner: [...byLogin].map(([login, list]) => ({
      login,
      active: list.length,
      open: list.length,
      inProgress: 0,
      done: 0,
      dismissed: 0,
      overdue: 0,
      items: list,
    })),
    byDue: [{ bucket: "no_date", label: "No due date", items }],
    assignees: [],
  };
}

describe("filterWantsClosed — the composition rule with includeClosed", () => {
  it("is false for the active statuses (the default fetch already carries them)", () => {
    expect(filterWantsClosed({ ...EMPTY_BACKLOG_FILTER, statuses: ["open", "in_progress"] })).toBe(false);
  });

  it("is TRUE for done and for dismissed — those rows only exist under includeClosed", () => {
    expect(filterWantsClosed({ ...EMPTY_BACKLOG_FILTER, statuses: ["done"] })).toBe(true);
    expect(filterWantsClosed({ ...EMPTY_BACKLOG_FILTER, statuses: ["dismissed"] })).toBe(true);
    // Mixed selections count too: an open+done chip pair still needs the wider fetch.
    expect(filterWantsClosed({ ...EMPTY_BACKLOG_FILTER, statuses: ["open", "done"] })).toBe(true);
  });

  it("a text search alone never widens the fetch", () => {
    expect(filterWantsClosed({ ...EMPTY_BACKLOG_FILTER, q: "dismissed done" })).toBe(false);
  });
});

describe("matchesBacklogFilter", () => {
  const it1 = item({ title: "Add CI gate", repo: "acme/web", assigneeLogin: "alice", status: "open" });

  it("matches free text across title, repo, dimension, impact and owner", () => {
    for (const q of ["ci gate", "acme/web", "D2", "ci/cd", "high", "alice"]) {
      expect(matchesBacklogFilter(it1, { ...EMPTY_BACKLOG_FILTER, q })).toBe(true);
    }
  });

  it("ANDs the terms — every whitespace-separated term must hit", () => {
    expect(matchesBacklogFilter(it1, { ...EMPTY_BACKLOG_FILTER, q: "ci alice" })).toBe(true);
    expect(matchesBacklogFilter(it1, { ...EMPTY_BACKLOG_FILTER, q: "ci bob" })).toBe(false);
  });

  it("filters by status and by owner, with UNASSIGNED distinct from 'any owner'", () => {
    expect(matchesBacklogFilter(it1, { ...EMPTY_BACKLOG_FILTER, statuses: ["done"] })).toBe(false);
    expect(matchesBacklogFilter(it1, { ...EMPTY_BACKLOG_FILTER, owner: "bob" })).toBe(false);
    expect(matchesBacklogFilter(it1, { ...EMPTY_BACKLOG_FILTER, owner: UNASSIGNED })).toBe(false);
    expect(matchesBacklogFilter(item({ assigneeLogin: null }), { ...EMPTY_BACKLOG_FILTER, owner: UNASSIGNED })).toBe(true);
    expect(matchesBacklogFilter(it1, EMPTY_BACKLOG_FILTER)).toBe(true);
  });
});

describe("filterBacklog", () => {
  const b = backlog([
    item({ id: "a", title: "Add CI gate", assigneeLogin: "alice" }),
    item({ id: "b", title: "Write ADRs", assigneeLogin: "bob" }),
    item({ id: "c", title: "Add CI cache", assigneeLogin: "bob", status: "done" }),
  ]);

  it("returns the SAME object when no filter is active (no needless re-render)", () => {
    expect(filterIsActive(EMPTY_BACKLOG_FILTER)).toBe(false);
    expect(filterBacklog(b, EMPTY_BACKLOG_FILTER)).toBe(b);
  });

  it("narrows both groupings and drops groups that empty out", () => {
    // "add" rather than "ci": every fixture row shares the D2 CI/CD dimension label, and the
    // search deliberately covers the dimension text the row renders.
    const out = filterBacklog(b, { ...EMPTY_BACKLOG_FILTER, q: "add" });
    expect(backlogItemIds(out).sort()).toEqual(["a", "c"]);
    expect(out.byOwner.map((g) => g.login)).toEqual(["alice", "bob"]);
    expect(out.byDue[0]!.items).toHaveLength(2);

    const onlyBob = filterBacklog(b, { ...EMPTY_BACKLOG_FILTER, owner: "alice" });
    expect(onlyBob.byOwner).toHaveLength(1);
  });

  it("composes status + text: a closed-status chip narrows to the closed rows the wider fetch carried", () => {
    const out = filterBacklog(b, { ...EMPTY_BACKLOG_FILTER, statuses: ["done"], q: "add" });
    expect(backlogItemIds(out)).toEqual(["c"]);
  });

  it("leaves the HEADLINE COUNTS untouched — the summary strip can't swing as the user types", () => {
    const out = filterBacklog(b, { ...EMPTY_BACKLOG_FILTER, q: "nothing-matches-this" });
    expect(backlogItemCount(out)).toBe(0);
    expect(out.byOwner).toHaveLength(0);
    expect({ open: out.open, inProgress: out.inProgress, done: out.done, dismissed: out.dismissed }).toEqual({
      open: 7,
      inProgress: 3,
      done: 5,
      dismissed: 2,
    });
  });

  it("sources owner options from the rows present, not from the org roster", () => {
    expect(backlogOwnerOptions(b)).toEqual({ logins: ["alice", "bob"], hasUnassigned: false });
    expect(backlogOwnerOptions(backlog([item({ assigneeLogin: null })]))).toEqual({ logins: [], hasUnassigned: true });
  });
});
