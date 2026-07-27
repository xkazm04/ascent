// Pins BOTH sign-in-moment decisions of the ACTIVE Supabase OAuth callback.
//
// (1) Post-sign-in DESTINATION (launch-fleet-map 07-27): a sign-in that carries no destination of its
// own used to fall back to `/` (the marketing home), which is why /launch — the cinematic mission-
// control entrance — was unreachable in production. It must now land on /launch, while an EXPLICIT
// ?next= (the onboarding resume round-trip, /connect, a deep-linked report) always wins.
//
// (2) Failure surfacing (github-oauth-session 07-16 #2):
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
// Only the request-origin helper is stubbed; safeNext is the REAL open-redirect guard, so the
// "a tampered next collapses to the no-destination case (and therefore to /launch, never off-origin)"
// claim below is pinned against the actual implementation rather than a hand-rolled approximation.
vi.mock("@/lib/auth", async () => ({
  ...(await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth")),
  publicOriginForRequest: vi.fn(() => "https://ascent.example"),
}));

import { GET } from "./route";

beforeEach(() => {
  mockExchange.mockReset();
});

const req = (qs: string) => new Request(`https://internal:3000/auth/callback${qs}`);

describe("GET /auth/callback — post-sign-in destination", () => {
  beforeEach(() => mockExchange.mockResolvedValue({ error: null }));

  it("an EXPLICIT ?next= always wins (the onboarding wizard's sign-in handoff round-trips)", async () => {
    for (const dest of ["/org/acme", "/onboarding", "/onboarding?org=acme", "/connect", "/report/vercel/next.js"]) {
      const res = await GET(req(`?code=abc&next=${encodeURIComponent(dest)}`));
      expect(res.headers.get("location")).toBe(`https://ascent.example${dest}`);
    }
  });

  it("a sign-in with NO destination lands on /launch — not the marketing home it used to", async () => {
    const res = await GET(req("?code=abc"));
    expect(res.headers.get("location")).toBe("https://ascent.example/launch");
  });

  it("treats an explicit ?next=/ as no destination (the header CTA's default) → /launch", async () => {
    const res = await GET(req("?code=abc&next=%2F"));
    expect(res.headers.get("location")).toBe("https://ascent.example/launch");
  });

  it("routes a RETURNING sign-in to /launch too — /launch itself bounces a fleet-less viewer to /connect", async () => {
    // The dormant custom-OAuth stack never detected a first run either (it split on its own resync
    // cookie); Supabase gives no cheap, trustworthy first-run signal, so the rule is destination-based,
    // not identity-based. Two consecutive sign-ins by the same user therefore both land on /launch.
    expect((await GET(req("?code=first"))).headers.get("location")).toBe("https://ascent.example/launch");
    expect((await GET(req("?code=second"))).headers.get("location")).toBe("https://ascent.example/launch");
  });

  it("a tampered `next` is neutralized to the no-destination case → /launch, never off-origin", async () => {
    for (const evil of ["https://evil.example/steal", "//evil.example", "/\\evil.example", "/ok\\x"]) {
      const res = await GET(req(`?code=abc&next=${encodeURIComponent(evil)}`));
      expect(res.headers.get("location")).toBe("https://ascent.example/launch");
    }
  });
});

describe("GET /auth/callback — Supabase sign-in failure surfacing", () => {

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
