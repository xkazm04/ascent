// @vitest-environment jsdom
//
// What the pending-invite roster (InviteList) actually shows an owner about each invite.
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

describe("InviteList — an invite's provenance", () => {
  it("names the owner who sent it", () => {
    render(<MemberInvites slug="acme" initialInvites={[invite({ id: "alpha", invitedBy: "alice" })]} />);
    expect(screen.getByText(/invited by @alice/i)).toBeTruthy();
  });

  it("says nothing where the inviter is unknown (a pre-wall row) rather than 'invited by @null'", () => {
    render(<MemberInvites slug="acme" initialInvites={[invite({ id: "alpha", invitedBy: null })]} />);
    expect(screen.queryByText(/invited by/i)).toBeNull();
  });
});
