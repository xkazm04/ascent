// @vitest-environment jsdom
//
// Pins backlog-management 07-09 #2: after a SUCCESSFUL status PATCH whose follow-up refresh is swallowed
// (503/blip), the optimistic value must STAY on screen — not snap back to the stale pre-edit value with
// no error (a phantom "my save reverted"). Also pins the correct revert on a genuinely failed PATCH.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, act, cleanup } from "@testing-library/react";
import { BacklogPanel } from "@/components/org/backlog/BacklogPanel";
import type { OrgBacklog, BacklogItem } from "@/lib/db";

const item: BacklogItem = {
  id: "rec1",
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
};

const backlog: OrgBacklog = {
  org: "acme",
  includesClosed: false,
  repos: 1,
  tracked: 1,
  active: 1,
  assigned: 0,
  unassigned: 1,
  dueSoon: 0,
  open: 1,
  inProgress: 0,
  done: 0,
  dismissed: 0,
  overdue: 0,
  byOwner: [{ login: null, active: 1, open: 1, inProgress: 0, done: 0, dismissed: 0, overdue: 0, items: [item] }],
  byDue: [],
  assignees: [],
};

const ok = (body: unknown = { ok: true }) => new Response(JSON.stringify(body), { status: 200 });
const fail = (status = 503) => new Response(JSON.stringify({ error: "server unavailable" }), { status });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function changeStatusToDone() {
  const select = screen.getByLabelText("Status") as HTMLSelectElement;
  await act(async () => {
    select.value = "done";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  return select;
}

describe("BacklogPanel — optimistic override lifetime (DOM)", () => {
  it("keeps the saved value on screen when the post-PATCH refresh is swallowed (#2)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes("/api/recommendations/")) return ok(); // PATCH succeeds
        if (u.includes("/api/org/backlog")) return fail(); // refresh silently fails
        return ok();
      }),
    );
    render(<BacklogPanel slug="acme" initial={backlog} />);
    const select = await changeStatusToDone();
    // The server has "done"; the refresh failed, so the row must retain "done", not revert to "open".
    await waitFor(() => expect(select.value).toBe("done"));
    expect(select.value).toBe("done");
    expect(screen.queryByText(/Couldn|server unavailable|Network error/i)).toBeNull(); // no error on a saved change
  });

  it("reverts the control AND shows an error when the PATCH itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes("/api/recommendations/")) return fail(500); // PATCH fails
        return ok();
      }),
    );
    render(<BacklogPanel slug="acme" initial={backlog} />);
    const select = await changeStatusToDone();
    await waitFor(() => expect(select.value).toBe("open")); // reverted to the server value
    expect(screen.getByText("server unavailable")).toBeInTheDocument();
  });
});

// ── G6-02: a terminal status change is REVERSIBLE, not gated behind a confirm ──────────────────────
// Picking "Done"/"Dismissed" drops the row from the ACTIVE-filtered backlog on the next read, so it
// used to be a one-click, unrecoverable loss. The panel now offers the change back (undo) and can
// re-read with the closed rows included so an older mistake is still findable.

describe("BacklogPanel — reversible terminal status changes (G6-02)", () => {
  it("offers the change back after a successful Done, and undo PATCHes the prior status", async () => {
    const calls: { url: string; body?: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const u = String(url);
        calls.push({ url: u, body: typeof init?.body === "string" ? init.body : undefined });
        if (u.includes("/api/org/backlog")) {
          // The item is closed now, so the ACTIVE view legitimately no longer contains it.
          return ok({ backlog: { ...backlog, active: 0, open: 0, done: 1, byOwner: [], byDue: [] } });
        }
        return ok();
      }),
    );
    render(<BacklogPanel slug="acme" initial={backlog} />);
    await changeStatusToDone();

    // The row is gone from the list — the undo affordance is the only thing standing between the user
    // and a silently lost item, so it must be present and name the restore target.
    const undoBtn = await screen.findByRole("button", { name: /Undo \(back to Open\)/ });
    expect(screen.getByText("Add CI gate")).toBeInTheDocument(); // named in the undo bar
    // No confirm dialog was ever shown — the action itself stays one click.
    expect(screen.queryByRole("dialog")).toBeNull();

    await act(async () => {
      undoBtn.click();
    });

    const patches = calls.filter((c) => c.url.includes("/api/recommendations/"));
    expect(patches).toHaveLength(2);
    expect(JSON.parse(patches[0].body!)).toEqual({ status: "done" });
    expect(JSON.parse(patches[1].body!)).toEqual({ status: "open" }); // restored, not guessed
    await waitFor(() => expect(screen.queryByRole("button", { name: /Undo/ })).toBeNull());
  });

  it("keeps the undo offer up when the undo PATCH itself fails (still the only way back)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const u = String(url);
        if (u.includes("/api/recommendations/")) {
          const body = typeof init?.body === "string" ? init.body : "";
          return body.includes("open") ? fail(500) : ok(); // the close works, the undo doesn't
        }
        if (u.includes("/api/org/backlog")) return ok({ backlog: { ...backlog, active: 0, byOwner: [], byDue: [] } });
        return ok();
      }),
    );
    render(<BacklogPanel slug="acme" initial={backlog} />);
    await changeStatusToDone();
    const undoBtn = await screen.findByRole("button", { name: /Undo \(back to Open\)/ });
    await act(async () => {
      undoBtn.click();
    });
    expect(screen.getByRole("button", { name: /Undo \(back to Open\)/ })).toBeInTheDocument();
  });

  it("re-reads with includeClosed=1 when 'Show done & dismissed' is pressed, restoring the row's controls", async () => {
    const urls: string[] = [];
    const closedItem: BacklogItem = { ...item, status: "dismissed" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        urls.push(u);
        if (u.includes("includeClosed=1")) {
          return ok({
            backlog: {
              ...backlog,
              includesClosed: true,
              active: 0,
              open: 0,
              dismissed: 1,
              byOwner: [{ login: null, active: 0, open: 0, inProgress: 0, done: 0, dismissed: 1, overdue: 0, items: [closedItem] }],
            },
          });
        }
        return ok({ backlog: { ...backlog, active: 0, open: 0, dismissed: 1, byOwner: [], byDue: [] } });
      }),
    );
    // Start from the state a mis-click leaves behind: nothing active, one dismissed item.
    render(<BacklogPanel slug="acme" initial={{ ...backlog, active: 0, open: 0, dismissed: 1, byOwner: [], byDue: [] }} />);
    // Even the empty state points at the recovery route rather than dead-ending.
    expect(screen.getByText(/to review or restore the 1 closed item/)).toBeInTheDocument();

    await act(async () => {
      screen.getByRole("button", { name: /Show done & dismissed/ }).click();
    });

    await waitFor(() => expect(urls.some((u) => u.includes("includeClosed=1"))).toBe(true));
    // The dismissed row is back on screen WITH its status control — the route back to Open.
    const status = (await screen.findByLabelText("Status")) as HTMLSelectElement;
    expect(status.value).toBe("dismissed");
    expect(status.disabled).toBe(false);
  });
});

// ── backlog-management #3: focus restore across the regroup remount ────────────────────────────────
// An inline owner edit re-groups the row into a different owner Card, unmounting+remounting it, which
// would strand keyboard/SR focus on <body>. The panel records the edited control and, once the refresh
// re-renders the moved row, restores focus to it by its stable data-focus-key.

function ownerGroupOf(login: string, items: BacklogItem[]) {
  return { login, open: items.length, inProgress: 0, done: 0, dismissed: 0, overdue: 0, active: items.length, items };
}

function backlogWith(owner: "alice" | "bob"): OrgBacklog {
  const it: BacklogItem = { ...item, assigneeLogin: owner };
  return {
    ...backlog,
    assigned: 1,
    unassigned: 0,
    byOwner:
      owner === "alice"
        ? [ownerGroupOf("alice", [it]), ownerGroupOf("bob", [])]
        : [ownerGroupOf("alice", []), ownerGroupOf("bob", [it])],
    assignees: ["alice", "bob"],
  };
}

describe("BacklogPanel — focus restore across a regroup remount (#3)", () => {
  it("returns keyboard focus to the moved row's owner control after the edit remounts it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes("/api/recommendations/")) return ok(); // PATCH succeeds
        if (u.includes("/api/org/backlog")) return new Response(JSON.stringify({ backlog: backlogWith("bob") }), { status: 200 });
        return ok();
      }),
    );
    render(<BacklogPanel slug="acme" initial={backlogWith("alice")} />);

    const owner = screen.getByLabelText("Owner") as HTMLSelectElement;
    owner.focus();
    expect(document.activeElement).toBe(owner);

    await act(async () => {
      owner.value = "bob";
      owner.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // After PATCH → refresh → remount, focus lands on the NEW (moved) owner control, not <body>.
    await waitFor(() => {
      const moved = document.querySelector<HTMLElement>('[data-focus-key="rec1:owner"]');
      expect(moved).not.toBeNull();
      expect(document.activeElement).toBe(moved);
    });
  });
});
