// @vitest-environment jsdom
//
// Pins the optimistic-rollback fix (members-access-control 07-09 #4): a FAILED role change must revert
// ONLY its own row via a targeted functional update — never replay a whole-array snapshot captured at
// call time, which would resurrect a member a concurrent remove already deleted. Rows mutate
// concurrently (each is gated only by `busy === m.login`), so snapshot rollback doesn't compose.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, within, act, cleanup } from "@testing-library/react";
import { MembersPanel } from "@/features/admin/members/MembersPanel";

interface Deferred {
  url: string;
  method: string;
  resolve: (r: Response) => void;
  reject: (e: unknown) => void;
}
let calls: Deferred[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (url: string | URL, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          calls.push({ url: String(url), method: init?.method ?? "GET", resolve, reject });
        }),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
const fail = () => new Response(JSON.stringify({ error: "boom" }), { status: 500 });

const members = [
  { login: "alice", name: null, role: "owner" as const, createdAt: "2026-01-01T00:00:00.000Z" },
  { login: "bob", name: null, role: "admin" as const, createdAt: "2026-01-02T00:00:00.000Z" },
  { login: "carol", name: null, role: "member" as const, createdAt: "2026-01-03T00:00:00.000Z" },
];

function renderPanel() {
  render(<MembersPanel slug="acme" initial={members} initialInvites={[]} selfLogin={null} />);
}

describe("MembersPanel — optimistic rollback (DOM)", () => {
  it("a failed role change reverts only that row and surfaces the error", async () => {
    renderPanel();
    const select = screen.getByLabelText("Role for carol") as HTMLSelectElement;
    await act(async () => {
      select.value = "viewer";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(select.value).toBe("viewer"); // optimistic
    await act(async () => {
      calls.find((c) => c.method === "POST")!.resolve(fail());
    });
    expect(select.value).toBe("member"); // reverted to the prior role
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });

  it("a role change that fails does NOT resurrect a member removed concurrently (#4)", async () => {
    renderPanel();

    // 1) Start a role change on alice (owner→member). Its POST is left in flight.
    const aliceSelect = screen.getByLabelText("Role for alice") as HTMLSelectElement;
    await act(async () => {
      aliceSelect.value = "member";
      aliceSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // 2) Concurrently remove bob (confirm), and let his DELETE succeed.
    const bobRow = screen.getByText("@bob").closest("tr")!;
    await act(async () => {
      within(bobRow).getByText("remove").click();
    });
    await act(async () => {
      within(bobRow).getByText("confirm").click();
    });
    await act(async () => {
      calls.find((c) => c.method === "DELETE")!.resolve(ok());
    });
    expect(screen.queryByText("@bob")).toBeNull(); // bob is gone

    // 3) NOW alice's POST fails. Old code restored a stale snapshot → bob reappears. Fixed code reverts
    //    only alice's role via a functional update, so bob stays removed.
    await act(async () => {
      calls.find((c) => c.method === "POST")!.resolve(fail());
    });
    expect(screen.queryByText("@bob")).toBeNull(); // still gone — not resurrected
    expect((screen.getByLabelText("Role for alice") as HTMLSelectElement).value).toBe("owner"); // alice reverted
  });
});
