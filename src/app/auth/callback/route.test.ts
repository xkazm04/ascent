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

const { mockExchange, mockAfter, mockDiscover } = vi.hoisted(() => ({
  mockExchange: vi.fn(),
  mockAfter: vi.fn(),
  mockDiscover: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    redirect: vi.fn((url: URL) => new Response(null, { status: 307, headers: { location: url.toString() } })),
  },
  after: mockAfter,
}));
vi.mock("@/lib/auth-discovery", () => ({ discoverOrgsForLogin: mockDiscover }));

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
  mockAfter.mockReset();
  mockDiscover.mockReset();
  mockDiscover.mockResolvedValue({});
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

// (3) Watchlist seeding on the ACTIVE stack. This callback used to do authentication ONLY, so a
// brand-new production user landed on an empty dashboard — discovery + seeding lived in the DORMANT
// callback, which never runs here. It is deferred via after() because sign-in is the most
// conversion-sensitive step in the funnel and this costs two GitHub round-trips plus a DB write.
describe("post-sign-in discovery + watchlist seeding", () => {
  const req = () => new Request("https://ascent.example/auth/callback?code=abc");
  /** Run whatever the route deferred, standing in for the post-response phase. */
  const runDeferred = async () => {
    for (const [fn] of mockAfter.mock.calls) await (fn as () => unknown)();
  };

  it("seeds using the GitHub provider token from the exchange, DEFERRED (not inline)", async () => {
    mockExchange.mockResolvedValue({
      data: { session: { provider_token: "gho_tok" }, user: { user_metadata: { user_name: "dev" } } },
      error: null,
    });

    const res = await GET(req());

    expect(res.status).toBe(307); // redirected immediately
    expect(mockDiscover).not.toHaveBeenCalled(); // …before any discovery ran
    expect(mockAfter).toHaveBeenCalledTimes(1);

    await runDeferred();
    // No installed-org list: Supabase's token can't enumerate App installations, so seeding is
    // public-repos-only via selectSeedTarget.
    expect(mockDiscover).toHaveBeenCalledWith("gho_tok", "dev");
  });

  it("skips discovery when the exchange returned no provider token", async () => {
    mockExchange.mockResolvedValue({
      data: { session: {}, user: { user_metadata: { user_name: "dev" } } },
      error: null,
    });
    await GET(req());
    expect(mockAfter).not.toHaveBeenCalled();
  });

  it("skips discovery when the identity carries no GitHub login", async () => {
    mockExchange.mockResolvedValue({
      data: { session: { provider_token: "gho_tok" }, user: { user_metadata: {} } },
      error: null,
    });
    await GET(req());
    expect(mockAfter).not.toHaveBeenCalled();
  });

  it("a discovery failure can never surface after the response is sent", async () => {
    mockExchange.mockResolvedValue({
      data: { session: { provider_token: "gho_tok" }, user: { user_metadata: { user_name: "dev" } } },
      error: null,
    });
    mockDiscover.mockRejectedValue(new Error("github down"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await GET(req());
    await expect(runDeferred()).resolves.toBeUndefined();
  });

  it("does not attempt discovery when the code exchange itself failed", async () => {
    mockExchange.mockResolvedValue({ data: null, error: { message: "bad code" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await GET(req());
    expect(mockAfter).not.toHaveBeenCalled();
  });
});
