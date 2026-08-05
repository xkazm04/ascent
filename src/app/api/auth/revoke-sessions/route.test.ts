// "Sign out everywhere else" across BOTH auth stacks. The route used to read ONLY the dormant
// custom-OAuth cookie, so under the ACTIVE Supabase wall — where `ascent_session` is never minted —
// it found no session and bounced to /connect having revoked nothing: the user's self-serve kill
// switch for a lost or shared machine did not exist on the stack that IS production.
//
// The load-bearing assertions: the Supabase branch calls signOut with scope "others" (NOT global —
// that would sign the current browser out too, which is the opposite of this feature), and a FAILED
// revoke reports the failure instead of redirecting as though it worked.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGateEnabled, mockGetViewer, mockSignOut, mockDecodeSession, mockRevokeOther } = vi.hoisted(() => ({
  mockGateEnabled: vi.fn(),
  mockGetViewer: vi.fn(),
  mockSignOut: vi.fn(),
  mockDecodeSession: vi.fn(),
  mockRevokeOther: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/access", () => ({ authGateEnabled: mockGateEnabled, getViewer: mockGetViewer }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { signOut: mockSignOut } }),
}));
vi.mock("@/lib/auth", () => ({
  SESSION_COOKIE: "ascent_session",
  decodeSession: mockDecodeSession,
  revokeOtherSessions: mockRevokeOther,
  requireSameOrigin: () => null, // same-origin is asserted by its own suite; keep this one focused
}));

import { POST } from "./route";

const post = () => POST(new Request("http://localhost/api/auth/revoke-sessions", { method: "POST" }));
const location = (res: Response) => res.headers.get("location") ?? "";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("POST /api/auth/revoke-sessions — the ACTIVE Supabase wall", () => {
  beforeEach(() => mockGateEnabled.mockReturnValue(true));

  it("revokes OTHER sessions only — never the current browser", async () => {
    mockGetViewer.mockResolvedValue({ id: "u1", login: "dev" });
    mockSignOut.mockResolvedValue({ error: null });

    const res = await post();

    expect(mockSignOut).toHaveBeenCalledWith({ scope: "others" });
    expect(res.status).toBe(303);
    expect(location(res)).toContain("revoked=others");
  });

  it("does NOT fall through to the dormant custom-OAuth path", async () => {
    mockGetViewer.mockResolvedValue({ id: "u1", login: "dev" });
    mockSignOut.mockResolvedValue({ error: null });

    await post();

    expect(mockDecodeSession).not.toHaveBeenCalled();
    expect(mockRevokeOther).not.toHaveBeenCalled();
  });

  it("reports a FAILED revoke instead of claiming success", async () => {
    // On a shared machine, "we revoked your other sessions" when we did not is the worst answer.
    mockGetViewer.mockResolvedValue({ id: "u1", login: "dev" });
    mockSignOut.mockResolvedValue({ error: { message: "auth server down" } });

    const res = await post();

    expect(location(res)).toContain("error=revoke");
    expect(location(res)).not.toContain("revoked=");
  });

  it("bounces a signed-out caller with nothing revoked", async () => {
    mockGetViewer.mockResolvedValue(null);

    const res = await post();

    expect(mockSignOut).not.toHaveBeenCalled();
    expect(location(res)).toContain("/connect");
    expect(location(res)).not.toContain("revoked=");
  });
});

describe("POST /api/auth/revoke-sessions — the dormant custom-OAuth stack is unchanged", () => {
  beforeEach(() => mockGateEnabled.mockReturnValue(false));

  it("still uses revokeOtherSessions when the gate is off", async () => {
    mockDecodeSession.mockReturnValue(null); // no cookie in this harness → the no-session bounce
    const res = await post();

    expect(mockSignOut).not.toHaveBeenCalled();
    expect(location(res)).toContain("/connect");
  });
});
