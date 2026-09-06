// @vitest-environment jsdom
//
// The invite list's optimistic rollback, pinned for the same reason the sibling roster's is
// (MembersPanel.test.tsx, members-access-control 07-09 #4). `revokeInvite` captured a WHOLE-ARRAY
// snapshot (`const prev = invites`) at call time and replayed it on failure. Rows revoke
// concurrently — there is no per-row busy lock here at all — so replaying that snapshot resurrects
// an invite a concurrent revoke has already deleted on the server. The roster fixed this in
// useMembersPanel.remove (targeted functional re-insert at the original index) and documented WHY;
// this file is the same rule's gate on the second implementation of it.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, within, act, cleanup } from "@testing-library/react";
import { MemberInvites, type InviteRow } from "@/features/admin/members/MemberInvites";

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

const invite = (over: Partial<InviteRow> & { id: string }): InviteRow => ({
  email: null,
  githubLogin: over.id,
  role: "member",
  expiresAt: new Date(Date.now() + 6 * 86_400_000).toISOString(),
  ...over,
});

/** The revoke button inside the row whose target label is `@login`. */
function revokeButtonFor(login: string): HTMLElement {
  const row = screen.getByText(`@${login}`).closest("li");
  if (!row) throw new Error(`no row for @${login}`);
  return within(row as HTMLElement).getByRole("button", { name: /revoke/i });
}

/** Fill the target field and press Create invite. */
async function create(target: string) {
  const input = screen.getByPlaceholderText(/GitHub login or email/i) as HTMLInputElement;
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, target);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    screen.getByRole("button", { name: /create invite/i }).click();
  });
}

const created = (emailed: string | null, email: string | null) =>
  new Response(
    JSON.stringify({
      invite: { id: "new", email, githubLogin: email ? null : "someone", role: "member", token: "tok", expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString() },
      emailed,
    }),
    { status: 200 },
  );

describe("MemberInvites — invite mail delivery is disclosed (DOM)", () => {
  it("reports a delivered invite mail, naming the address", async () => {
    render(<MemberInvites slug="acme" initialInvites={[]} />);
    await create("dana@example.com");
    await act(async () => {
      calls.find((c) => c.method === "POST")!.resolve(created("sent", "dana@example.com"));
      await Promise.resolve();
    });
    expect(screen.getByTestId("invite-delivery").textContent).toMatch(/emailed.*dana@example\.com/i);
  });

  it("tells the owner to deliver the link by hand when the deploy has no mail provider", async () => {
    render(<MemberInvites slug="acme" initialInvites={[]} />);
    await create("dana@example.com");
    await act(async () => {
      calls.find((c) => c.method === "POST")!.resolve(created("skipped", "dana@example.com"));
      await Promise.resolve();
    });
    const note = screen.getByTestId("invite-delivery").textContent ?? "";
    expect(note).toMatch(/not sent|no email|wasn't sent/i);
    expect(note).toMatch(/copy the link/i);
  });

  it("announces a FAILED send rather than implying a delivery", async () => {
    render(<MemberInvites slug="acme" initialInvites={[]} />);
    await create("dana@example.com");
    await act(async () => {
      calls.find((c) => c.method === "POST")!.resolve(created("failed", "dana@example.com"));
      await Promise.resolve();
    });
    const el = screen.getByTestId("invite-delivery");
    expect(el.getAttribute("role")).toBe("alert");
    expect(el.textContent).toMatch(/couldn't|could not/i);
    expect(el.textContent).toMatch(/copy the link/i);
  });

  it("says nothing about mail for a GitHub-login invite, which has no address to send to", async () => {
    render(<MemberInvites slug="acme" initialInvites={[]} />);
    await create("someone");
    await act(async () => {
      calls.find((c) => c.method === "POST")!.resolve(created(null, null));
      await Promise.resolve();
    });
    expect(screen.queryByTestId("invite-delivery")).toBeNull();
  });
});

describe("MemberInvites — optimistic revoke rollback (DOM)", () => {
  it("a failed revoke restores only its own row and surfaces the error", async () => {
    render(<MemberInvites slug="acme" initialInvites={[invite({ id: "alpha" }), invite({ id: "beta" })]} />);

    await act(async () => {
      revokeButtonFor("alpha").click();
    });
    expect(screen.queryByText("@alpha")).toBeNull();
    expect(screen.getByText("@beta")).toBeTruthy();

    const call = calls.find((c) => c.method === "DELETE" && c.url.includes("alpha"));
    await act(async () => {
      call!.resolve(fail());
      await Promise.resolve();
    });

    expect(screen.getByText("@alpha")).toBeTruthy();
    expect(screen.getByText("@beta")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/revoke/i);
  });

  it("a failed revoke does NOT resurrect an invite a concurrent revoke already removed", async () => {
    render(<MemberInvites slug="acme" initialInvites={[invite({ id: "alpha" }), invite({ id: "beta" })]} />);

    // Both revokes are in flight at once — nothing in this panel serializes them.
    await act(async () => {
      revokeButtonFor("alpha").click();
    });
    await act(async () => {
      revokeButtonFor("beta").click();
    });

    const alphaCall = calls.find((c) => c.method === "DELETE" && c.url.includes("alpha"));
    const betaCall = calls.find((c) => c.method === "DELETE" && c.url.includes("beta"));

    // beta succeeds on the server; alpha fails and rolls back.
    await act(async () => {
      betaCall!.resolve(ok());
      await Promise.resolve();
    });
    await act(async () => {
      alphaCall!.resolve(fail());
      await Promise.resolve();
    });

    expect(screen.getByText("@alpha")).toBeTruthy();
    // The bug: replaying alpha's call-time snapshot puts beta back, so the owner sees a pending
    // invite the server has already revoked.
    expect(screen.queryByText("@beta")).toBeNull();
  });
});
