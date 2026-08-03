// /me is now the header identity link's destination, so it is hit from BOTH identity stacks rather
// than only from the two Supabase-era CTAs that used to be the only way in. It therefore has to
// resolve the login the way the rest of the app does (resolveViewerLogin: custom-OAuth session first,
// then the Supabase / dev-bypass viewer) — a getViewer-only lookup would bounce a custom-OAuth session
// straight back to /connect, which is the dead end this exists to remove.

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  resolveViewerLogin: vi.fn(async () => null as string | null),
  redirect: vi.fn((to: string) => {
    // Next's redirect throws to unwind the render; mirror that so control flow matches production.
    throw new Error(`REDIRECT:${to}`);
  }),
}));

vi.mock("@/lib/access", () => ({ resolveViewerLogin: h.resolveViewerLogin }));
vi.mock("next/navigation", () => ({ redirect: h.redirect }));

import MePage from "@/app/me/page";

const redirectTarget = async () => {
  try {
    await MePage();
  } catch (e) {
    return String((e as Error).message).replace("REDIRECT:", "");
  }
  throw new Error("expected a redirect");
};

describe("/me", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lands a signed-in viewer on their identity-bound personal workspace", async () => {
    h.resolveViewerLogin.mockResolvedValue("alice");
    expect(await redirectTarget()).toBe("/org/alice");
  });

  it("normalizes the login to the slug form the personal-namespace claim compares against", async () => {
    // login === slug is what makes the auto-claim safe; a case/whitespace mismatch would miss the
    // viewer's own namespace and land them on an org they have no standing in.
    h.resolveViewerLogin.mockResolvedValue("  AlIcE  ");
    expect(await redirectTarget()).toBe("/org/alice");
  });

  it("sends a signed-out visitor to sign in rather than to an org they can't read", async () => {
    h.resolveViewerLogin.mockResolvedValue(null);
    expect(await redirectTarget()).toBe("/connect");
  });
});
