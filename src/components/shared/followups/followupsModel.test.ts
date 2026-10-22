// The Follow-ups ledger's client-side model. Pure, and until now untested — the module carries the
// filter / sort / selection arithmetic EVERY ledger surface shares, so a defect here is a defect on
// all of them at once. Two of the invariants below are regressions this file was written against:
//
//  1. `isSelectable` — the batch-eligibility rule was stated twice (the row checkbox disabled a
//     closed row; the header's select-all added every SHOWN row) and the two statements disagreed,
//     so in the resolved archive "select all" loaded the bulk bar with rows the user could not then
//     untick one at a time and the three batch actions had nothing to do to.
//  2. `sortByValue`'s effort tie-break ranked effort through the IMPACT map (high → 0), listing the
//     most EXPENSIVE item first — the reverse of the "cheapest first" it documents.

import { describe, it, expect } from "vitest";
import {
  ACTIVE_STATUSES,
  applyFilters,
  dimensionSpread,
  emptyFilters,
  filtersActive,
  isSelectable,
  rowsFromBacklog,
  sortByValue,
  summarizeSelection,
  type FollowUpRow,
  type FollowUpStatus,
} from "./followupsModel";

function row(over: Partial<FollowUpRow> = {}): FollowUpRow {
  return {
    id: "r1",
    repo: "acme/api",
    repoName: "api",
    title: "Agent guidance is thin",
    dimId: "D1",
    dimLabel: "AI Tooling",
    impact: "high",
    effort: "low",
    rationale: "Conventions get re-derived on every change.",
    explore: [],
    projectedPoints: 5,
    status: "open",
    lastActivityAt: "2026-08-01T00:00:00.000Z",
    unlocks: null,
    assigneeLogin: null,
    ...over,
  };
}

describe("isSelectable — one rule for what a batch may act on", () => {
  it("admits the working set and refuses both closed states", () => {
    expect(isSelectable(row({ status: "open" }))).toBe(true);
    expect(isSelectable(row({ status: "in_progress" }))).toBe(true);
    expect(isSelectable(row({ status: "done" }))).toBe(false);
    expect(isSelectable(row({ status: "dismissed" }))).toBe(false);
  });

  it("is exactly ACTIVE_STATUSES — the same set the default filter shows", () => {
    for (const s of ["open", "in_progress", "done", "dismissed"] as FollowUpStatus[]) {
      expect(isSelectable(row({ status: s }))).toBe(ACTIVE_STATUSES.has(s));
    }
  });

  it("selecting every selectable row in the ARCHIVE view selects nothing (the regression)", () => {
    // What the worklist's select-all does: filter the shown rows through isSelectable. In the
    // archive the shown set is entirely closed, so the batch stays empty instead of filling with
    // rows whose checkboxes are disabled.
    const rows = [row({ id: "a", status: "done" }), row({ id: "b", status: "dismissed" })];
    const archive = applyFilters(rows, { ...emptyFilters(), statuses: new Set(["done", "dismissed"]) });
    expect(archive).toHaveLength(2);
    expect(archive.filter(isSelectable)).toEqual([]);
  });
});

describe("sortByValue", () => {
  it("orders by projected points desc, then impact, then effort CHEAPEST first, then title", () => {
    const out = sortByValue([
      row({ id: "cheap", projectedPoints: 4, impact: "high", effort: "low" }),
      row({ id: "dear", projectedPoints: 4, impact: "high", effort: "high" }),
      row({ id: "mid", projectedPoints: 4, impact: "high", effort: "medium" }),
    ]).map((r) => r.id);
    expect(out).toEqual(["cheap", "mid", "dear"]);
  });

  it("puts the bigger projected gain first regardless of effort", () => {
    const out = sortByValue([
      row({ id: "small", projectedPoints: 1, effort: "low" }),
      row({ id: "big", projectedPoints: 9, effort: "high" }),
    ]).map((r) => r.id);
    expect(out).toEqual(["big", "small"]);
  });

  it("sinks an unknown-ROI row below every scored one, and breaks a full tie on title", () => {
    const out = sortByValue([
      row({ id: "unknown", title: "zzz", projectedPoints: null }),
      row({ id: "zero", title: "bbb", projectedPoints: 0 }),
      row({ id: "zero2", title: "aaa", projectedPoints: 0 }),
    ]).map((r) => r.id);
    expect(out).toEqual(["zero2", "zero", "unknown"]);
  });
});

describe("applyFilters", () => {
  const rows = [
    row({ id: "o", status: "open", repo: "acme/api", dimId: "D1", impact: "high" }),
    row({ id: "p", status: "in_progress", repo: "acme/web", dimId: "D2", impact: "low" }),
    row({ id: "d", status: "done", repo: "acme/web", dimId: "D2", impact: "high" }),
  ];

  it("shows the working set (open + in_progress) when no status is picked", () => {
    expect(applyFilters(rows, emptyFilters()).map((r) => r.id)).toEqual(["o", "p"]);
  });

  it("an explicit status set REPLACES the working-set default (the archive switch)", () => {
    expect(applyFilters(rows, { ...emptyFilters(), statuses: new Set(["done"]) }).map((r) => r.id)).toEqual(["d"]);
  });

  it("ANDs repo, dimension and impact with the status rule", () => {
    const f = { ...emptyFilters(), repos: new Set(["acme/web"]), dims: new Set(["D2"]), impacts: new Set(["low"]) };
    expect(applyFilters(rows, f).map((r) => r.id)).toEqual(["p"]);
  });

  it("searches title, rationale, repo and dimension label, case-insensitively", () => {
    expect(applyFilters(rows, { ...emptyFilters(), query: "  ACME/WEB " }).map((r) => r.id)).toEqual(["p"]);
    expect(applyFilters(rows, { ...emptyFilters(), query: "re-derived" }).map((r) => r.id)).toEqual(["o", "p"]);
    expect(applyFilters(rows, { ...emptyFilters(), query: "nothing here" })).toEqual([]);
  });

  it("the org-wide chip drops every row whose dimension has no spread entry", () => {
    const spread = dimensionSpread(rows);
    expect(applyFilters(rows, { ...emptyFilters(), orgWide: true }, spread).map((r) => r.id)).toEqual(["o", "p"]);
    // No spread map supplied → nothing can be proven org-wide, so nothing passes.
    expect(applyFilters(rows, { ...emptyFilters(), orgWide: true })).toEqual([]);
  });

  it("filtersActive tracks every control, and a whitespace-only query is not a filter", () => {
    expect(filtersActive(emptyFilters())).toBe(false);
    expect(filtersActive({ ...emptyFilters(), query: "   " })).toBe(false);
    expect(filtersActive({ ...emptyFilters(), query: "x" })).toBe(true);
    expect(filtersActive({ ...emptyFilters(), orgWide: true })).toBe(true);
    expect(filtersActive({ ...emptyFilters(), statuses: new Set(["done"]) })).toBe(true);
  });
});

describe("dimensionSpread — a gap open in half the fleet is an ORG gap", () => {
  it("counts DISTINCT repos per dimension over the active rows only", () => {
    const spread = dimensionSpread([
      row({ id: "1", dimId: "D1", repo: "acme/a", status: "open" }),
      row({ id: "2", dimId: "D1", repo: "acme/a", status: "open" }), // same repo — counted once
      row({ id: "3", dimId: "D1", repo: "acme/b", status: "in_progress" }),
      row({ id: "4", dimId: "D2", repo: "acme/c", status: "open" }),
      row({ id: "5", dimId: "D3", repo: "acme/d", status: "done" }), // closed — no spread entry
    ]);
    expect(spread.get("D1")).toEqual({ dimId: "D1", repos: 2, of: 4, orgWide: true });
    expect(spread.get("D2")).toEqual({ dimId: "D2", repos: 1, of: 4, orgWide: false });
    expect(spread.get("D3")).toBeUndefined();
  });

  it("never calls a single-repo fleet org-wide (the `of >= 2` guard)", () => {
    const spread = dimensionSpread([row({ id: "1", dimId: "D1", repo: "acme/only", status: "open" })]);
    expect(spread.get("D1")!.orgWide).toBe(false);
  });
});

describe("summarizeSelection", () => {
  it("totals the picked rows, their distinct repos and their projected points", () => {
    const rows = [
      row({ id: "a", repo: "acme/api", projectedPoints: 5 }),
      row({ id: "b", repo: "acme/api", projectedPoints: 3 }),
      row({ id: "c", repo: "acme/web", projectedPoints: null }),
    ];
    expect(summarizeSelection(rows, new Set(["a", "b", "c"]))).toMatchObject({ count: 3, repos: 2, points: 8 });
    expect(summarizeSelection(rows, new Set())).toMatchObject({ count: 0, repos: 0, points: 0 });
    // A stale id (its row was resolved and refetched away) contributes nothing rather than throwing.
    expect(summarizeSelection(rows, new Set(["gone"]))).toMatchObject({ count: 0, points: 0 });
  });
});

describe("rowsFromBacklog", () => {
  it("flattens every owner group into ranked rows and defaults an unknown status to open", () => {
    const backlog = {
      byOwner: [
        { items: [{ ...backlogItem("hi", 9), status: "in_progress" }] },
        { items: [{ ...backlogItem("lo", 2), status: "banana" }] },
      ],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a minimal OrgBacklog stand-in: rowsFromBacklog reads only byOwner[].items.
    const rows = rowsFromBacklog(backlog as any);
    expect(rows.map((r) => r.id)).toEqual(["hi", "lo"]); // 9 pts before 2
    expect(rows[0]!.status).toBe("in_progress");
    expect(rows[1]!.status).toBe("open"); // unrecognised status is not carried through
  });
});

function backlogItem(id: string, points: number) {
  return {
    id,
    repo: "acme/api",
    repoName: "api",
    title: id,
    dimId: "D1",
    dimLabel: "AI Tooling",
    impact: "high",
    effort: "low",
    rationale: "",
    explore: [],
    projectedPoints: points,
    status: "open",
    lastActivityAt: "2026-08-01T00:00:00.000Z",
    unlocks: null,
    assigneeLogin: null,
  };
}
