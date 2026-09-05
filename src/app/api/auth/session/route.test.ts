// Pins the dual-stack contract of /api/auth/session (github-oauth-session 07-16 #1): under the
// ACTIVE Supabase login wall the endpoint must report the Supabase viewer, NOT the dormant
// custom-OAuth session state — the old implementation resolved only getSessionState(), whose
// isAuthConfigured() short-circuit is false in the documented prod config, so every signed-in
// Supabase user was reported as signed out. Gate off → the custom stack still answers unchanged.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init);
    }
  },
}));

const { mockAuthGateEnabled, mockGetViewer, mockGetSessionState } = vi.hoisted(() => ({
  mockAuthGateEnabled: vi.fn(),
  mockGetViewer: vi.fn(),
  mockGetSessionState: vi.fn(),
}));

vi.mock("@/lib/access", () => ({ authGateEnabled: mockAuthGateEnabled, getViewer: mockGetViewer }));
vi.mock("@/lib/auth", () => ({ getSessionState: mockGetSessionState }));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/auth/session — dual-stack identity", () => {
  it("reports the ACTIVE Supabase viewer when the gate is on (never consults the dormant stack)", async () => {
    mockAuthGateEnabled.mockReturnValue(true);
    mockGetViewer.mockResolvedValue({ id: "u1", login: "octocat", name: "Octo Cat", avatar: "https://a/img.png" });

    const res = await GET();
    const body = await res.json();

    expect(body).toEqual({
      status: "active",
      login: "octocat",
      name: "Octo Cat",
      image: "https://a/img.png",
      installations: [],
      expiresAt: null,
    });
    // The dormant custom-OAuth path must not even run — its "none" would be misleading in prod.
    expect(mockGetSessionState).not.toHaveBeenCalled();
    expect(res.headers.get("cache-control")).toBe("no-store, private");
  });

  it("reports signed-out under the gate when there is no Supabase viewer", async () => {
    mockAuthGateEnabled.mockReturnValue(true);
    mockGetViewer.mockResolvedValue(null);

    const body = await (await GET()).json();

    expect(body.status).toBe("none");
    expect(body.login).toBeNull();
    expect(mockGetSessionState).not.toHaveBeenCalled();
  });

  it("falls through to the custom-OAuth session state when the gate is off", async () => {
    mockAuthGateEnabled.mockReturnValue(false);
    mockGetSessionState.mockResolvedValue({
      status: "active",
      expiresAt: "2026-08-01T00:00:00.000Z",
      session: { login: "selfhost", name: null, image: null, installations: [{ login: "acme" }] },
    });

    const body = await (await GET()).json();

    expect(body).toEqual({
      status: "active",
      login: "selfhost",
      name: null,
      image: null,
      installations: ["acme"],
      expiresAt: "2026-08-01T00:00:00.000Z",
    });
    expect(mockGetViewer).not.toHaveBeenCalled();
  });

  it("gate off + no session → the documented signed-out shape", async () => {
    mockAuthGateEnabled.mockReturnValue(false);
    mockGetSessionState.mockResolvedValue({ status: "none", session: null, expiresAt: null });

    const body = await (await GET()).json();

    expect(body).toEqual({ status: "none", login: null, name: null, image: null, installations: [], expiresAt: null });
  });
});
