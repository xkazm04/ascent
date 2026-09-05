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
import { fireEvent, render, screen } from "@testing-library/react";

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

  it("opens a menu on the identity under the LIVE Supabase login, with /me still the first row", async () => {
    h.getViewer.mockResolvedValue({ login: "alice", avatar: "https://example.test/a.png" });
    render(await HeaderAccount());

    // The identity is a MENU trigger now, not a bare link — Developer joined /me behind your own name.
    const trigger = screen.getByRole("button", { name: /alice/ });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    // Closed, it exposes no destinations at all: the menu is the only way to them.
    expect(screen.queryByRole("link", { name: "Your workspace Your repos, scored" })).toBeNull();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const rows = screen.getAllByRole("menuitem");
    expect(rows[0]).toHaveAttribute("href", "/me");
    expect(rows[1]).toHaveAttribute("href", "/org/developer");
  });

  it("opens the same menu under the dormant custom-OAuth branch — one identity affordance, not two", async () => {
    h.supabaseAuthConfigured.mockReturnValue(false);
    h.getSession.mockResolvedValue({ login: "bob", installations: [] });
    render(await HeaderAccount());

    const trigger = screen.getByRole("button", { name: /bob/ });
    fireEvent.click(trigger);
    const rows = screen.getAllByRole("menuitem");
    expect(rows.map((r) => r.getAttribute("href"))).toEqual(["/me", "/org/developer"]);
    // The old dead link pointed at the GitHub-App install flow. Nothing in this cluster may still do so.
    expect(rows.map((r) => r.getAttribute("href"))).not.toContain("/connect");
  });

  it("folds sign out into the menu rather than leaving it loose beside the name", async () => {
    h.getViewer.mockResolvedValue({ login: "alice" });
    render(await HeaderAccount());
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /alice/ }));
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  // Escape must both close AND restore focus to the trigger: dismissing to <body> restarts a keyboard
  // user's tab order at the top of the document, which is the half of the ARIA menu contract that
  // silently goes missing.
  it("closes on Escape and hands focus back to the trigger", async () => {
    h.getViewer.mockResolvedValue({ login: "alice" });
    render(await HeaderAccount());
    const trigger = screen.getByRole("button", { name: /alice/ });
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("offers no workspace link at all when nobody is signed in", async () => {
    render(await HeaderAccount());
    expect(screen.queryByRole("link", { name: /\/me/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });
});
