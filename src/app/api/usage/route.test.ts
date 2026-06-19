// Integration test for the /api/usage cross-tenant authorization gate (IDOR).
// usage/route.ts:56-77 must enforce the same org scoping the /usage page does: a caller may
// only read the "public" org or an org their session installations include. The INVARIANT we
// pin is behavioral, not implementational — every denial path returns the right status AND the
// usage reader (getUsageSummary) is never invoked, so no tenant's volume/timeline/repo names are
// ever computed on a rejected request; an authorized own-org caller gets the data. The gate must
// run BEFORE the read. The auth/db boundaries are mocked so we can assert exactly when the reader
// fires. Mirrors the in-house route-integration pattern in src/app/api/scan/route.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Subclasses Response so BOTH `NextResponse.json(...)` (the gate/summary paths) AND
// `new NextResponse(body, init)` (the CSV/JSON download paths exercised by the header-injection
// tests below) behave like a real Response and expose `.headers` / `.text()`.
vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/auth", () => ({ getSession: vi.fn(), isAuthConfigured: vi.fn() }));
vi.mock("@/lib/db", () => ({ getUsageSummary: vi.fn(), isDbConfigured: vi.fn() }));

import { GET } from "./route";
import { getSession, isAuthConfigured } from "@/lib/auth";
import { getUsageSummary, isDbConfigured } from "@/lib/db";

const mockGetSession = vi.mocked(getSession);
const mockIsAuthConfigured = vi.mocked(isAuthConfigured);
const mockGetUsageSummary = vi.mocked(getUsageSummary);
const mockIsDbConfigured = vi.mocked(isDbConfigured);

function get(query: string) {
  return GET(new Request(`http://localhost/api/usage${query}`));
}

// A minimal UsageSummary-shaped object; the gate doesn't inspect its contents.
const SUMMARY = { daily: [] } as unknown as Awaited<ReturnType<typeof getUsageSummary>>;

// A session whose installations include `logins` (case is normalized in the route).
const sessionWith = (...logins: string[]) =>
  ({ installations: logins.map((login) => ({ login })) }) as unknown as Awaited<
    ReturnType<typeof getSession>
  >;

describe("GET /api/usage — cross-tenant authorization gate (IDOR) (#2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDbConfigured.mockReturnValue(true); // DB on, so we reach the authz gate (not the 503)
    mockGetUsageSummary.mockResolvedValue(SUMMARY);
  });

  it("DENIES a private org when auth is not configured (403) and never reads usage", async () => {
    mockIsAuthConfigured.mockReturnValue(false);

    const res = await get("?org=acme");

    expect(res.status).toBe(403);
    expect(mockGetUsageSummary).not.toHaveBeenCalled();
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it("DENIES an unauthenticated caller of a private org (401) and never reads usage", async () => {
    mockIsAuthConfigured.mockReturnValue(true);
    mockGetSession.mockResolvedValue(null);

    const res = await get("?org=acme");

    expect(res.status).toBe(401);
    expect(mockGetUsageSummary).not.toHaveBeenCalled();
  });

  it("DENIES a non-member requesting another org's usage (403) and never reads usage", async () => {
    mockIsAuthConfigured.mockReturnValue(true);
    mockGetSession.mockResolvedValue(sessionWith("my-own-org"));

    const res = await get("?org=acme"); // caller is NOT a member of acme

    expect(res.status).toBe(403);
    expect(mockGetUsageSummary).not.toHaveBeenCalled();
  });

  it("ALLOWS a member requesting their own org's usage (200) and reads the data once", async () => {
    mockIsAuthConfigured.mockReturnValue(true);
    mockGetSession.mockResolvedValue(sessionWith("Acme")); // membership is case-insensitive

    const res = await get("?org=acme");

    expect(res.status).toBe(200);
    expect(mockGetUsageSummary).toHaveBeenCalledTimes(1);
    expect(mockGetUsageSummary).toHaveBeenCalledWith("acme", expect.any(Number));
  });

  it("ALLOWS the shared public org without a session (200)", async () => {
    mockIsAuthConfigured.mockReturnValue(true);
    mockGetSession.mockResolvedValue(null);

    const res = await get("?org=public");

    expect(res.status).toBe(200);
    expect(mockGetSession).not.toHaveBeenCalled(); // public org short-circuits before the session check
    expect(mockGetUsageSummary).toHaveBeenCalledTimes(1);
  });

  it("defaults to the public org (no ?org) and serves it without auth (200)", async () => {
    mockIsAuthConfigured.mockReturnValue(true);
    mockGetSession.mockResolvedValue(null);

    const res = await get("");

    expect(res.status).toBe(200);
    expect(mockGetUsageSummary).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// MEDIUM finding #5 (docs/harness/test-mastery-2026-06-18/usage-metering-public-badge.md):
// "Test `safeFilenameSlug` header-injection guard and the public-org day cap".
// Two security-motivated transforms on UNAUTHENTICATED input (route.ts:25 safeFilenameSlug,
// route.ts:41 the day cap) had no test. Both are pinned BEHAVIORALLY through the route.
// A non-empty `daily` series gives toCsv real rows on the export path.
const EXPORT_SUMMARY = {
  org: "public",
  periodDays: 30,
  daily: [{ date: "2026-06-18", billable: 1, free: 2 }],
} as unknown as Awaited<ReturnType<typeof getUsageSummary>>;

// ---------------------------------------------------------------------------
// (a) safeFilenameSlug — Content-Disposition header-injection / response-splitting guard.
// The slug is interpolated into the download filename; a `"`, CR/LF, `;`, or `/` must NOT
// survive into the header — else it spoofs the filename or splits the response. To reach the
// export path with an arbitrary (hostile) slug we authorize the caller FOR that exact org
// (a session whose installation login matches it, case-insensitively) — the route still must
// sanitize the slug it trusts. This is strictly stronger than the public path: even an
// authorized org name can't poison the header.
describe("GET /api/usage — safeFilenameSlug Content-Disposition header-injection guard (#5a)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDbConfigured.mockReturnValue(true);
    mockIsAuthConfigured.mockReturnValue(true);
    mockGetUsageSummary.mockResolvedValue(EXPORT_SUMMARY);
  });

  // CR/LF can NEVER be legitimate in this single-line header — their presence is response
  // splitting, full stop. (The structural `filename="…"` quotes are legitimate, so `"`/`;`/`/`
  // are instead pinned inside the extracted slug via the safe-charset regex below.)
  const SPLIT_BYTES = ["\r", "\n"];

  // Each hostile slug is authorized as the caller's own org below, so it flows to the export
  // path and through safeFilenameSlug — the exact transform under test.
  const HOSTILE: ReadonlyArray<[string, string]> = [
    ['a"b', "embedded double-quote (closes the filename attr)"],
    ["a\r\nSet-Cookie: x=1", "CRLF response-splitting / injected header"],
    ["a;b", "semicolon (adds a Content-Disposition param)"],
    ["org/../x", "path separators + traversal dots"],
    ["..", "bare parent-dir"],
    ["   ", "all-whitespace (must fall back, never empty)"],
    ["日本", "non-ASCII bytes"],
    ["A".repeat(100), "over the 64-char cap"],
    ['"; attachment; filename="evil', "full filename-spoof attempt"],
  ];

  for (const format of ["csv", "json"] as const) {
    for (const [slug, why] of HOSTILE) {
      it(`sanitizes ?org=${JSON.stringify(slug)} (${why}) in the ${format} download filename`, async () => {
        // Authorize the caller for this exact org so the request reaches the export path; the
        // route lowercases both sides of the membership check.
        mockGetSession.mockResolvedValue(sessionWith(slug.toLowerCase()));
        const res = await get(`?org=${encodeURIComponent(slug)}&format=${format}`);

        expect(res.status).toBe(200);
        const cd = res.headers.get("content-disposition") ?? "";
        expect(cd).not.toBe("");

        // No CR/LF anywhere in the header → no response-splitting / injected second header.
        for (const ch of SPLIT_BYTES) {
          expect(cd).not.toContain(ch);
        }

        // The header is exactly one well-formed Content-Disposition with a single quoted
        // filename: nothing the attacker supplied opened a second `filename=`/param or closed
        // the quote early. The interpolated slug is a single non-empty safe ascii token, which
        // by construction excludes the breakout bytes `"`, `;`, and `/`.
        const m = cd.match(
          /^attachment; filename="ascent-usage-(.*?)-\d{4}-\d{2}-\d{2}\.(?:csv|json)"$/,
        );
        expect(m, `filename did not match the expected safe shape: ${cd}`).not.toBeNull();
        const fileSlug = m![1];
        expect(fileSlug).toMatch(/^[a-z0-9-]{1,64}$/); // ONLY safe chars, capped length
        expect(fileSlug).not.toBe(""); // never empty (falls back to "org")
        for (const ch of ['"', ";", "/"]) {
          expect(fileSlug).not.toContain(ch); // attacker-controlled portion is byte-clean
        }
      });
    }
  }

  it("falls back to the literal 'org' token when the slug reduces to nothing", async () => {
    // '日本' cleans to "" → the route must substitute "org", never an empty token (an empty slug
    // would yield `ascent-usage--<date>` and is the easiest regression).
    mockGetSession.mockResolvedValue(sessionWith("日本"));
    const res = await get(`?org=${encodeURIComponent("日本")}&format=csv`);
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).toContain('filename="ascent-usage-org-');
  });

  it("preserves a benign slug verbatim (the guard does not mangle legitimate names)", async () => {
    // public org needs no session; it reaches the export path unauthenticated.
    mockGetSession.mockResolvedValue(null);
    const res = await get(`?org=public&format=json`);
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).toMatch(/filename="ascent-usage-public-\d{4}-\d{2}-\d{2}\.json"/);
  });
});

// ---------------------------------------------------------------------------
// (b) public-org day cap — anonymous-DoS amplification guard.
// days = Math.min(orgLc === "public" ? 90 : 365, Math.max(1, Number(days) || 30)).
// We capture the EXACT `days` the route hands getUsageSummary; the public/unauthenticated window
// can NEVER exceed 90, no matter the requested value.
describe("GET /api/usage — public-org day-window cap (#5b)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDbConfigured.mockReturnValue(true);
    mockIsAuthConfigured.mockReturnValue(true);
    mockGetSession.mockResolvedValue(null);
    mockGetUsageSummary.mockResolvedValue(SUMMARY);
  });

  function daysPassed(): number {
    expect(mockGetUsageSummary).toHaveBeenCalledTimes(1);
    return mockGetUsageSummary.mock.calls[0][1] as number;
  }

  it("clamps the PUBLIC org to 90 days when 365 is requested (anti-DoS cap)", async () => {
    const res = await get("?org=public&days=365");
    expect(res.status).toBe(200);
    expect(daysPassed()).toBe(90);
  });

  it("clamps the public org for ANY over-90 request (1000 → 90)", async () => {
    await get("?org=public&days=1000");
    expect(daysPassed()).toBe(90);
  });

  it("clamps the public org when NO org param is given (defaults to public)", async () => {
    await get("?days=365"); // org omitted → "public"
    expect(daysPassed()).toBe(90);
  });

  it("falls back to 30 days on a non-numeric ?days=", async () => {
    await get("?org=public&days=abc");
    expect(daysPassed()).toBe(30);
  });

  it("treats ?days=0 as the 30-day default (0 is falsy → `|| 30`), never a 0-day window", async () => {
    // Number("0") is 0, which is falsy, so `Number(...) || 30` yields 30 — the route never
    // computes a zero-length window. (Negatives, which ARE truthy, floor to 1 below.)
    await get("?org=public&days=0");
    expect(daysPassed()).toBe(30);
  });

  it("floors a negative ?days= to 1 (truthy, so it survives `|| 30` then max(1, …))", async () => {
    await get("?org=public&days=-5");
    expect(daysPassed()).toBe(1);
  });

  it("passes a within-cap public request through unchanged (days=45)", async () => {
    await get("?org=public&days=45");
    expect(daysPassed()).toBe(45);
  });

  it("lets a MEMBER org reach the wider 365-day window (the cap is public-only)", async () => {
    // A real org with a session that includes it is authorized AND uncapped to 365 — proving the
    // 90-day clamp is scoped to the unauthenticated public org, not applied to everyone.
    mockGetSession.mockResolvedValue(sessionWith("acme"));
    const res = await get("?org=acme&days=365");
    expect(res.status).toBe(200);
    expect(daysPassed()).toBe(365);
  });

  it("still caps a member org's over-365 request at 365", async () => {
    mockGetSession.mockResolvedValue(sessionWith("acme"));
    await get("?org=acme&days=99999");
    expect(daysPassed()).toBe(365);
  });
});
