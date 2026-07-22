// @vitest-environment jsdom
//
// github-oauth-session #5: a Supabase sign-in / sign-out failure used to be swallowed to console.error —
// the button un-spun and NOTHING visible happened, so the user (and any screen reader) got no cue the
// action failed: a silent dead click that looks like success. These pin that both failures now surface a
// VISIBLE, announced (role="alert") error and leave the control usable for a retry.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const { signInWithOAuth, signOut } = vi.hoisted(() => ({
  signInWithOAuth: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ auth: { signInWithOAuth, signOut } }),
}));

import { SupabaseSignInButton, SignOutButton } from "./SupabaseAuthButtons";

afterEach(() => vi.clearAllMocks());

describe("SupabaseSignInButton failure is visible", () => {
  it("shows an announced error when signInWithOAuth returns an error (no redirect happened)", async () => {
    signInWithOAuth.mockResolvedValue({ error: { message: "provider unavailable" } });
    render(<SupabaseSignInButton next="/" />);

    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    const alert = await waitFor(() => screen.getByRole("alert"));
    expect(alert.textContent).toContain("Couldn't start GitHub sign-in");
    // The button is re-enabled so the user can retry.
    expect(screen.getByRole("button", { name: /sign in/i })).not.toBeDisabled();
  });
});

// github-oauth-session (2026-07-16) #4: the sign-in CTA deliberately keeps `pending` until navigation
// leaves the page — but when the user backs out of GitHub's consent screen, bfcache restores the page
// with `pending` still true: a permanently disabled spinner (aria-busy forever) with no recovery short
// of a manual reload. The `pageshow` (persisted) restore must reset the CTA to idle and clickable.
describe("SupabaseSignInButton recovers after a bfcache restore (back from the consent screen)", () => {
  function pageShow(persisted: boolean) {
    const ev = new Event("pageshow");
    Object.defineProperty(ev, "persisted", { value: persisted });
    window.dispatchEvent(ev);
  }

  it("resets the stuck pending spinner when the page is restored from bfcache", async () => {
    signInWithOAuth.mockResolvedValue({ error: null }); // "success": the browser is navigating away
    render(<SupabaseSignInButton next="/" />);

    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    // The deliberate happy-path behavior: pending sticks while the redirect is (supposedly) in flight.
    await waitFor(() => expect(screen.getByRole("button", { name: /sign in/i })).toBeDisabled());

    // A NON-persisted pageshow (a normal fresh load also fires one) must NOT touch the state…
    pageShow(false);
    expect(screen.getByRole("button", { name: /sign in/i })).toBeDisabled();

    // …but the bfcache restore (persisted: true) un-sticks the CTA: enabled, idle, not aria-busy.
    pageShow(true);
    await waitFor(() => expect(screen.getByRole("button", { name: /sign in/i })).not.toBeDisabled());
    expect(screen.getByRole("button", { name: /sign in/i }).getAttribute("aria-busy")).toBe("false");
  });
});

describe("SignOutButton failure is visible", () => {
  it("shows an announced error when signOut returns an error, and does NOT navigate away", async () => {
    signOut.mockResolvedValue({ error: { message: "network blip" } });
    render(<SignOutButton />);

    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));

    const alert = await waitFor(() => screen.getByRole("alert"));
    expect(alert.textContent).toContain("Sign-out didn't complete");
    // Never pretend the sign-out succeeded: no redirect home.
    expect(push).not.toHaveBeenCalled();
  });
});
