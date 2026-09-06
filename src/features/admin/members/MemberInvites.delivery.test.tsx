// @vitest-environment jsdom
//
// The invite mail's DELIVERY DISCLOSURE. POST /api/org/invites reports `emailed` honestly — sent |
// skipped (no provider on this deploy) | failed | null (a GitHub-login invite, no address) — and the
// route's own header says the field exists so the UI can tell the owner to share the link manually
// rather than implying a delivery. It had no consumer: an owner on a provider-less deploy created an
// invite, saw a success, and waited for mail that was never going to arrive.
//
// Sibling theme file of MemberInvites.test.tsx (AGENTS.md: a test file over the 200-LOC cap splits
// into <name>.<theme>.test.tsx, each with its own pragma and mock setup).

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
