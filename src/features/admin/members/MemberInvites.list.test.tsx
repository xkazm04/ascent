// @vitest-environment jsdom
//
// What the pending-invite roster (InviteList) actually shows an owner about each invite.
//
// Sibling theme file of MemberInvites.test.tsx (AGENTS.md: a test file over the 200-LOC cap splits
// into <name>.<theme>.test.tsx, each with its own pragma and mock setup).

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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

const invite = (over: Partial<InviteRow> & { id: string }): InviteRow => ({
  email: null,
  githubLogin: over.id,
  role: "member",
  expiresAt: new Date(Date.now() + 6 * 86_400_000).toISOString(),
  ...over,
});

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

// The invite mail tells the invitee "expires in N days"; the owner's own list stated the same
// deadline as a raw host-locale date, so finding the invite about to lapse meant subtracting dates.
// Relative by default, absolute one hover away (registry status-vocabulary → timestamp-display).
describe("InviteList — when an invite lapses", () => {
  it("counts the days down rather than printing a date", () => {
    const iso = new Date(Date.now() + 6 * 86_400_000).toISOString();
    render(<MemberInvites slug="acme" initialInvites={[invite({ id: "alpha", expiresAt: iso })]} />);
    const el = screen.getByText(/expires in 6 days/i);
    expect(el).toBeTruthy();
    // ...and the precise moment is still reachable, on the hover title.
    expect(el.getAttribute("title")).toBe(new Date(iso).toLocaleString());
  });
});

// With no pending invites the roster rendered NOTHING — the owner could not tell "nobody is waiting"
// from "the list didn't load", and the panel's own copy promises a list right above the silence.
describe("InviteList — nothing pending", () => {
  it("says so, rather than rendering an absence", () => {
    render(<MemberInvites slug="acme" initialInvites={[]} />);
    expect(screen.getByText(/no pending invit/i)).toBeTruthy();
  });

  it("drops the empty state as soon as there is a row", () => {
    render(<MemberInvites slug="acme" initialInvites={[invite({ id: "alpha" })]} />);
    expect(screen.queryByText(/no pending invit/i)).toBeNull();
  });
});
