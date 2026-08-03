// @vitest-environment jsdom
//
// The personal tier had no front door. Everything behind it worked — /me → /org/{login}, the personal
// org kind, the PERSONAL_TAB_IDS nav subset, the zero-repo personal shell — but under the ACTIVE
// Supabase login the header rendered the viewer's identity as a plain <span> linking nowhere, and only
// the DORMANT custom-OAuth branch linked it, to /connect (the GitHub-App install flow, not a
// workspace). The only ways in were two incidental CTAs.
//
// These pin the fix as a property of BOTH branches, because "signed in ⇒ there is a persistent path to
// my workspace" is exactly the kind of thing that regresses invisibly when one branch is edited.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  getSession: vi.fn(async () => null as null | { login: string; image?: string; installations: string[] }),
  isAuthConfigured: vi.fn(() => true),
  getActiveOrg: vi.fn(async () => "public"),
  orgOptionsForSession: vi.fn(() => [] as string[]),
  getViewer: vi.fn(async () => null as null | { login: string; avatar?: string }),
  supabaseAuthConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/auth", () => ({
  getSession: h.getSession,
  isAuthConfigured: h.isAuthConfigured,
  getActiveOrg: h.getActiveOrg,
  orgOptionsForSession: h.orgOptionsForSession,
}));
vi.mock("@/lib/access", () => ({ getViewer: h.getViewer, supabaseAuthConfigured: h.supabaseAuthConfigured }));
vi.mock("@/lib/db", () => ({ isDbConfigured: () => false, listOrgsForLogin: vi.fn(async () => []) }));
vi.mock("@/components/GitHubSignInButton", () => ({ GitHubSignInButton: () => <button>Sign in</button> }));
vi.mock("@/components/SupabaseAuthButtons", () => ({
  SupabaseSignInButton: () => <button>Sign in</button>,
  SignOutButton: () => <button>Sign out</button>,
}));
vi.mock("@/components/OrgSwitcher", () => ({ OrgSwitcher: () => <div>switcher</div> }));

import { HeaderAccount } from "@/components/Brand";

describe("HeaderAccount — the personal-workspace door", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.isAuthConfigured.mockReturnValue(true);
    h.supabaseAuthConfigured.mockReturnValue(true);
    h.getSession.mockResolvedValue(null);
    h.getViewer.mockResolvedValue(null);
    h.orgOptionsForSession.mockReturnValue([]);
    h.getActiveOrg.mockResolvedValue("public");
  });

  it("links the identity to /me under the LIVE Supabase login (it used to be an unlinked span)", async () => {
    h.getViewer.mockResolvedValue({ login: "alice", avatar: "https://example.test/a.png" });
    render(await HeaderAccount());

    const link = screen.getByRole("link", { name: /alice/ });
    expect(link).toHaveAttribute("href", "/me");
    expect(link).toHaveAttribute("title", "Your personal workspace");
  });

  it("links the identity to /me under the dormant custom-OAuth branch too — same destination, not a second one", async () => {
    h.supabaseAuthConfigured.mockReturnValue(false);
    h.getSession.mockResolvedValue({ login: "bob", installations: [] });
    render(await HeaderAccount());

    const link = screen.getByRole("link", { name: /bob/ });
    expect(link).toHaveAttribute("href", "/me");
    // The old dead link pointed at the GitHub-App install flow. Nothing in this cluster may still do so.
    expect(screen.queryByRole("link", { name: /bob/ })).not.toHaveAttribute("href", "/connect");
  });

  it("offers no workspace link at all when nobody is signed in", async () => {
    render(await HeaderAccount());
    expect(screen.queryByRole("link", { name: /\/me/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });
});
