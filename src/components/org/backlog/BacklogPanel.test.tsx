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
