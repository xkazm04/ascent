// Pins the dual-stack contract of /api/auth/session (github-oauth-session 07-16 #1): under the
// ACTIVE Supabase login wall the endpoint must report the Supabase viewer, NOT the dormant
// custom-OAuth session state — the old implementation resolved only getSessionState(), whose
// isAuthConfigured() short-circuit is false in the documented prod config, so every signed-in
// Supabase user was reported as signed out. Gate off → the custom stack still answers unchanged.
//
// Under the wall the payload also carries the viewer's GitHub App installation LOGINS (same
// shape as the custom stack) so /launch can list orgs without a second round trip. Numeric
// installation ids stay off the wire. An unauthenticated caller must never receive them.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init);
    }
  },
}));

const { mockAuthGateEnabled, mockGetViewer, mockGetSessionState, mockViewerInstallations } = vi.hoisted(() => ({
  mockAuthGateEnabled: vi.fn(),
  mockGetViewer: vi.fn(),
  mockGetSessionState: vi.fn(),
  mockViewerInstallations: vi.fn(),
}));

vi.mock("@/lib/access", () => ({ authGateEnabled: mockAuthGateEnabled, getViewer: mockGetViewer }));
vi.mock("@/lib/auth", () => ({ getSessionState: mockGetSessionState }));
vi.mock("@/lib/viewer-installations", () => ({ viewerInstallations: mockViewerInstallations }));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mockViewerInstallations.mockResolvedValue([]);
});

describe("GET /api/auth/session — dual-stack identity", () => {
  it("reports the ACTIVE Supabase viewer when the gate is on (never consults the dormant stack)", async () => {
    mockAuthGateEnabled.mockReturnValue(true);
    mockGetViewer.mockResolvedValue({ id: "u1", login: "octocat", name: "Octo Cat", avatar: "https://a/img.png" });
    mockViewerInstallations.mockResolvedValue([
      { id: 42, login: "acme" },
      { id: 7, login: "beta" },
    ]);

    const res = await GET();
    const body = await res.json();

    expect(body).toEqual({
      status: "active",
      login: "octocat",
      name: "Octo Cat",
      image: "https://a/img.png",
      installations: ["acme", "beta"],
      expiresAt: null,
    });
    // Logins only — GitHub installation ids are not a session-status field.
    expect(body.installations.every((x: unknown) => typeof x === "string")).toBe(true);
    // The dormant custom-OAuth path must not even run — its "none" would be misleading in prod.
    expect(mockGetSessionState).not.toHaveBeenCalled();
    expect(res.headers.get("cache-control")).toBe("no-store, private");
  });

  it("reports signed-out under the gate when there is no Supabase viewer", async () => {
    mockAuthGateEnabled.mockReturnValue(true);
    mockGetViewer.mockResolvedValue(null);
    // If this were consulted for an anonymous caller, a stale custom-OAuth cookie could leak
    // another identity's org list onto a payload that claims status "none".
    mockViewerInstallations.mockResolvedValue([{ id: 99, login: "should-not-leak" }]);

    const body = await (await GET()).json();

    expect(body).toEqual({
      status: "none",
      login: null,
      name: null,
      image: null,
      installations: [],
      expiresAt: null,
    });
    expect(mockGetSessionState).not.toHaveBeenCalled();
    expect(mockViewerInstallations).not.toHaveBeenCalled();
  });

  it("still reports the viewer when installation lookup fails (status must not 500)", async () => {
    mockAuthGateEnabled.mockReturnValue(true);
    mockGetViewer.mockResolvedValue({ id: "u1", login: "octocat", name: null, avatar: null });
    mockViewerInstallations.mockRejectedValue(new Error("db down"));

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      status: "active",
      login: "octocat",
      name: null,
      image: null,
      installations: [],
      expiresAt: null,
    });
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
    expect(mockViewerInstallations).not.toHaveBeenCalled();
  });

  it("gate off + no session → the documented signed-out shape", async () => {
    mockAuthGateEnabled.mockReturnValue(false);
    mockGetSessionState.mockResolvedValue({ status: "none", session: null, expiresAt: null });

    const body = await (await GET()).json();

    expect(body).toEqual({ status: "none", login: null, name: null, image: null, installations: [], expiresAt: null });
    expect(mockViewerInstallations).not.toHaveBeenCalled();
  });
});
