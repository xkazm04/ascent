// Pins the failure surfacing of the ACTIVE Supabase OAuth callback (github-oauth-session 07-16 #2):
// the route used to redirect failures to `/?auth_error=1`, a flag no page ever rendered — a silent
// sign-in dead-end. Failures must now land on /connect, whose role="alert" banner already renders
// the error taxonomy, and a user-cancelled consent screen (error=access_denied) must map to the
// "denied" copy rather than being misreported as breakage.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    redirect: vi.fn((url: URL) => new Response(null, { status: 307, headers: { location: url.toString() } })),
  },
}));

const { mockExchange } = vi.hoisted(() => ({ mockExchange: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { exchangeCodeForSession: mockExchange } })),
}));
vi.mock("@/lib/auth", () => ({
  publicOriginForRequest: vi.fn(() => "https://ascent.example"),
  // Real-enough safeNext: same-origin path or the fallback.
  safeNext: vi.fn((next: string | null, fallback: string) => (next?.startsWith("/") ? next : fallback)),
}));

import { GET } from "./route";

beforeEach(() => {
  mockExchange.mockReset();
});

const req = (qs: string) => new Request(`https://internal:3000/auth/callback${qs}`);

describe("GET /auth/callback — Supabase sign-in failure surfacing", () => {
  it("redirects onward to `next` when the code exchange succeeds", async () => {
    mockExchange.mockResolvedValue({ error: null });
    const res = await GET(req("?code=abc&next=/org/acme"));
    expect(res.headers.get("location")).toBe("https://ascent.example/org/acme");
  });

  it("lands exchange failures on /connect?error=oauth_failed — a surface that RENDERS the error", async () => {
    mockExchange.mockResolvedValue({ error: { message: "invalid code" } });
    const res = await GET(req("?code=expired"));
    expect(res.headers.get("location")).toBe("https://ascent.example/connect?error=oauth_failed");
  });

  it("lands a missing code on /connect?error=oauth_failed (never the unread ?auth_error=1 flag)", async () => {
    const res = await GET(req(""));
    const loc = res.headers.get("location")!;
    expect(loc).toBe("https://ascent.example/connect?error=oauth_failed");
    expect(loc).not.toContain("auth_error");
  });

  it("maps a user-cancelled consent screen (error=access_denied) to the 'denied' copy, not breakage", async () => {
    const res = await GET(req("?error=access_denied&error_description=cancelled"));
    expect(res.headers.get("location")).toBe("https://ascent.example/connect?error=denied");
  });
});
