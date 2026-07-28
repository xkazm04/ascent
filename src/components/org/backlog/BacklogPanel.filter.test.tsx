// @vitest-environment jsdom
//
// G7-12 — the search/filter/bulk layer, proved AGAINST the surfaces it had to build on rather than
// around:
//   * typing narrows the list without touching the summary counts or refetching;
//   * a CLOSED status chip composes with the "show done & dismissed" fetch — it turns includeClosed
//     on rather than filtering a payload that never contained closed rows;
//   * bulk actions apply only to what's SELECTED and VISIBLE, are capped at MAX_BULK, and re-read the
//     backlog exactly once for the whole run.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, within } from "@testing-library/react";
import { BacklogPanel } from "@/components/org/backlog/BacklogPanel";
import { MAX_BULK } from "@/components/org/backlog/useBacklogBulk";
import type { BacklogItem, OrgBacklog } from "@/lib/db";

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
  return {
    org: "acme",
    includesClosed: false,
    repos: 1,
    tracked: items.length,
    active: items.length,
    assigned: 0,
    unassigned: items.length,
    dueSoon: 0,
    open: items.length,
    inProgress: 0,
    done: 4,
    dismissed: 0,
    overdue: 0,
    byOwner: [
      { login: null, active: items.length, open: items.length, inProgress: 0, done: 0, dismissed: 0, overdue: 0, items },
    ],
    byDue: [],
    assignees: [],
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const two = [item({ id: "a", title: "Add CI gate" }), item({ id: "b", title: "Write ADRs" })];

describe("BacklogPanel — search + filter (G7-12)", () => {
  it("narrows the list as the user types, and leaves the headline counts alone", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ backlog: backlog(two) }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<BacklogPanel slug="acme" initial={backlog(two)} />);

    expect(screen.getByText("Add CI gate")).toBeInTheDocument();
    expect(screen.getByText("Write ADRs")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search the backlog" }), { target: { value: "adrs" } });

    await waitFor(() => expect(screen.queryByText("Add CI gate")).toBeNull());
    expect(screen.getByText("Write ADRs")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 shown")).toBeInTheDocument();
    // Client-side narrowing only — a search must not hit the API.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("explains an empty result as 'nothing matched', not as an empty backlog", async () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<BacklogPanel slug="acme" initial={backlog(two)} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search the backlog" }), { target: { value: "zzz-no-match" } });

    await waitFor(() => expect(screen.getByText(/No backlog items match this search or filter/)).toBeInTheDocument());
    expect(screen.queryByText(/Nothing active in the backlog/)).toBeNull();
  });

  it("a CLOSED status chip turns includeClosed ON and re-reads — it composes with the toggle", async () => {
    const closed = item({ id: "c", title: "Old idea", status: "dismissed" });
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ backlog: { ...backlog([...two, closed]), includesClosed: true } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<BacklogPanel slug="acme" initial={backlog(two)} />);

    fireEvent.click(screen.getByRole("button", { name: /^Dismissed$/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("includeClosed=1");
    // The toggle itself flipped — the two controls describe ONE state, not two.
    expect(screen.getByRole("button", { name: /Hide done & dismissed/ })).toBeInTheDocument();
    // And the filter then narrows the widened payload to the dismissed row.
    await waitFor(() => expect(screen.getByText("Old idea")).toBeInTheDocument());
    expect(screen.queryByText("Add CI gate")).toBeNull();
  });
});

describe("BacklogPanel — bulk actions (G7-12)", () => {
  it("applies the chosen status to the SELECTED rows only, then re-reads once", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).startsWith("/api/org/backlog")
        ? new Response(JSON.stringify({ backlog: backlog(two) }), { status: 200 })
        : new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<BacklogPanel slug="acme" initial={backlog(two)} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /Select “Add CI gate”/ }));
    const bar = () => within(screen.getByRole("region", { name: "Bulk actions" }));
    fireEvent.click(bar().getByRole("button", { name: "Done" }));
    // Bulk status changes are CONFIRMED, not undone — the undo bar restores one row, not forty.
    fireEvent.click(screen.getByRole("button", { name: /^Set 1 to Done$/ }));

    await waitFor(() => expect(screen.getByText("1 of 1 updated")).toBeInTheDocument());
    const patches = fetchMock.mock.calls.filter((c) => String(c[0]).startsWith("/api/recommendations/"));
    expect(patches).toHaveLength(1);
    expect(String(patches[0]![0])).toBe("/api/recommendations/a");
    expect(JSON.parse(String((patches[0]![1] as RequestInit).body))).toEqual({ status: "done" });
    // Exactly ONE re-read for the whole run, not one per row.
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).startsWith("/api/org/backlog"))).toHaveLength(1);
  });

  it("bounds 'select all shown' at MAX_BULK, and says so", async () => {
    const many = Array.from({ length: MAX_BULK + 12 }, (_, i) => item({ id: `x${i}`, title: `Item ${i}` }));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ backlog: backlog(many) }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<BacklogPanel slug="acme" initial={backlog(many)} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /Select “Item 0”/ }));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`select all shown \\(${MAX_BULK}\\)`) }));

    await waitFor(() => expect(screen.getByText(new RegExp(`^${MAX_BULK} selected`))).toBeInTheDocument());
    expect(screen.getByText(`· max ${MAX_BULK} per action`)).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole("region", { name: "Bulk actions" })).getByRole("button", { name: "Dismissed" }));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^Set ${MAX_BULK} to Dismissed$`) }));

    await waitFor(() =>
      expect(screen.getByText(`${MAX_BULK} of ${MAX_BULK} updated`)).toBeInTheDocument(),
    );
    // The bound is real: never more than MAX_BULK writes from one action.
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).startsWith("/api/recommendations/"))).toHaveLength(MAX_BULK);
  });

  it("a selection can never reach a row the active filter hides", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ backlog: backlog(two) }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<BacklogPanel slug="acme" initial={backlog(two)} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /Select “Add CI gate”/ }));
    expect(screen.getByText(/^1 selected/)).toBeInTheDocument();

    // Filtering the selected row off screen drops it from the selection, so the bulk bar can't act on
    // something the user can no longer see.
    fireEvent.change(screen.getByRole("searchbox", { name: "Search the backlog" }), { target: { value: "adrs" } });

    await waitFor(() => expect(screen.queryByRole("region", { name: "Bulk actions" })).toBeNull());
  });
});
