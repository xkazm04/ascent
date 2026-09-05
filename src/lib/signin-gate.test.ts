// The regression this module exists for: under the ACTIVE Supabase wall the old page predicate
// `isAuthConfigured() && !session` was FALSE for everyone (the dormant env is unset in production), so
// the sign-in prompt never rendered. And when a page did render it, SignInNotice's default provider was
// the dormant custom-OAuth button, which dead-ends at /connect?error=not_configured.
//
// The first two cases below both fail against the old predicate. Keep them that way.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockGetViewer, mockGetSessionState, mockIsAuthConfigured, mockAuthGateEnabled } = vi.hoisted(() => ({
  mockGetViewer: vi.fn(),
  mockGetSessionState: vi.fn(),
  mockIsAuthConfigured: vi.fn(),
  mockAuthGateEnabled: vi.fn(),
}));

vi.mock("@/lib/access", () => ({ getViewer: mockGetViewer }));
vi.mock("@/lib/auth", () => ({
  getSessionState: mockGetSessionState,
  isAuthConfigured: mockIsAuthConfigured,
}));
vi.mock("@/lib/env", () => ({ authGateEnabled: mockAuthGateEnabled }));

import { resolveSignInState } from "./signin-gate";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSessionState.mockResolvedValue({ session: null, status: "none" });
});

describe("resolveSignInState", () => {
  it("PROD SHAPE: Supabase wall on, legacy off — a signed-out visitor IS prompted, with the supabase button", async () => {
    mockAuthGateEnabled.mockReturnValue(true);
    mockIsAuthConfigured.mockReturnValue(false); // the production configuration
    mockGetViewer.mockResolvedValue(null);

    const s = await resolveSignInState();

    expect(s.needsSignIn).toBe(true); // the old predicate said false here — the bug
    expect(s.provider).toBe("supabase"); // never the dormant github button, which dead-ends
    expect(s.expired).toBe(false);
  });

  it("PROD SHAPE: a signed-in Supabase viewer is NOT prompted", async () => {
    mockAuthGateEnabled.mockReturnValue(true);
    mockIsAuthConfigured.mockReturnValue(false);
    mockGetViewer.mockResolvedValue({ id: "1", login: "alice" });

    const s = await resolveSignInState();

    expect(s.needsSignIn).toBe(false);
    expect(s.provider).toBe("supabase");
  });

  it("never consults the dormant session to satisfy the ACTIVE wall", async () => {
    mockAuthGateEnabled.mockReturnValue(true);
    mockIsAuthConfigured.mockReturnValue(true); // both configured
    mockGetViewer.mockResolvedValue(null);
    mockGetSessionState.mockResolvedValue({ session: { login: "stale" }, status: "active" });

    // A stray custom-OAuth cookie must not let someone past the Supabase wall.
    expect((await resolveSignInState()).needsSignIn).toBe(true);
  });

  it("dev box with only the legacy OAuth configured: prompts, and distinguishes an expired session", async () => {
    mockAuthGateEnabled.mockReturnValue(false);
    mockIsAuthConfigured.mockReturnValue(true);
    mockGetSessionState.mockResolvedValue({ session: null, status: "expired" });

    const s = await resolveSignInState();

    expect(s.needsSignIn).toBe(true);
    expect(s.provider).toBe("github");
    expect(s.expired).toBe(true);
    expect(mockGetViewer).not.toHaveBeenCalled();
  });

  it("fully auth-off (local/demo): every page stays open", async () => {
    mockAuthGateEnabled.mockReturnValue(false);
    mockIsAuthConfigured.mockReturnValue(false);

    const s = await resolveSignInState();

    expect(s.needsSignIn).toBe(false);
    expect(mockGetViewer).not.toHaveBeenCalled();
  });
});
