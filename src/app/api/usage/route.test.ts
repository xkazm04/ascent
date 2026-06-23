// Integration test for the /api/usage cross-tenant authorization gate (IDOR) + the two download-path
// transforms. The route now delegates the org-read decision to the canonical requireOrgRead gate
// (src/lib/authz, whose own test pins the auth-off / no-session / non-member / Supabase-wall /
// open-dashboards branches). Here we pin the WIRING: when requireOrgRead returns a denial Response the
// handler returns EXACTLY that and getUsageSummary is NEVER called (no tenant's volume/timeline/repo
// names computed on a rejected request); when it allows, an authorized read returns the data. The
// gate must run BEFORE the read. Then we pin the two security-motivated download transforms
// (safeFilenameSlug header-injection guard + the public-org day cap) on the allowed path.

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
vi.mock("@/lib/db", () => ({ getUsageSummary: vi.fn(), isDbConfigured: vi.fn() }));
vi.mock("@/lib/authz", () => ({ requireOrgRead: vi.fn() }));

import { GET } from "./route";
import { getUsageSummary, isDbConfigured } from "@/lib/db";
import { requireOrgRead } from "@/lib/authz";

const mockGetUsageSummary = vi.mocked(getUsageSummary);
const mockIsDbConfigured = vi.mocked(isDbConfigured);
const mockRequireOrgRead = vi.mocked(requireOrgRead);

function get(query: string) {
  return GET(new Request(`http://localhost/api/usage${query}`));
}

const deny = (status: number) => new Response(JSON.stringify({ error: "denied" }), { status });

// A minimal UsageSummary-shaped object; the gate doesn't inspect its contents.
const SUMMARY = { daily: [] } as unknown as Awaited<ReturnType<typeof getUsageSummary>>;

describe("GET /api/usage — cross-tenant authorization gate (IDOR) (#2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDbConfigured.mockReturnValue(true); // DB on, so we reach the authz gate (not the 503)
    mockRequireOrgRead.mockResolvedValue(null); // default: authorized
    mockGetUsageSummary.mockResolvedValue(SUMMARY);
  });

  it("returns the gate's verbatim denial Response and never reads usage when access is refused", async () => {
    mockRequireOrgRead.mockResolvedValue(deny(403));

    const res = await get("?org=acme");

    expect(res.status).toBe(403);
    expect(mockRequireOrgRead).toHaveBeenCalledWith("acme");
    expect(mockGetUsageSummary).not.toHaveBeenCalled(); // the read is short-circuited by the gate
  });

  it("propagates a 401 denial (unauthenticated) verbatim and never reads usage", async () => {
    mockRequireOrgRead.mockResolvedValue(deny(401));

    const res = await get("?org=acme");

    expect(res.status).toBe(401);
    expect(mockGetUsageSummary).not.toHaveBeenCalled();
  });

  it("ALLOWS an authorized org (gate returns null) and reads the data once", async () => {
    const res = await get("?org=acme");

    expect(res.status).toBe(200);
    expect(mockRequireOrgRead).toHaveBeenCalledWith("acme");
    expect(mockGetUsageSummary).toHaveBeenCalledTimes(1);
    expect(mockGetUsageSummary).toHaveBeenCalledWith("acme", expect.any(Number));
  });

  it("defaults to the public org (no ?org) and gates on 'public'", async () => {
    const res = await get("");

    expect(res.status).toBe(200);
    expect(mockRequireOrgRead).toHaveBeenCalledWith("public");
    expect(mockGetUsageSummary).toHaveBeenCalledTimes(1);
  });

  it("returns 503 BEFORE consulting the gate when the DB is off", async () => {
    mockIsDbConfigured.mockReturnValue(false);

    const res = await get("?org=acme");

    expect(res.status).toBe(503);
    expect(mockRequireOrgRead).not.toHaveBeenCalled();
    expect(mockGetUsageSummary).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// safeFilenameSlug header-injection guard + the public-org day cap — two security-motivated
// transforms on the ALLOWED download path. The gate is forced open (requireOrgRead → null) so the
// request reaches the export path; the route still must sanitize the slug it interpolates.
const EXPORT_SUMMARY = {
  org: "public",
  periodDays: 30,
  daily: [{ date: "2026-06-18", billable: 1, free: 2 }],
} as unknown as Awaited<ReturnType<typeof getUsageSummary>>;

// ---------------------------------------------------------------------------
// (a) safeFilenameSlug — Content-Disposition header-injection / response-splitting guard.
// The slug is interpolated into the download filename; a `"`, CR/LF, `;`, or `/` must NOT
// survive into the header — else it spoofs the filename or splits the response.
describe("GET /api/usage — safeFilenameSlug Content-Disposition header-injection guard (#5a)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDbConfigured.mockReturnValue(true);
    mockRequireOrgRead.mockResolvedValue(null); // authorized → reaches the export path
    mockGetUsageSummary.mockResolvedValue(EXPORT_SUMMARY);
  });

  // CR/LF can NEVER be legitimate in this single-line header — their presence is response splitting.
  const SPLIT_BYTES = ["\r", "\n"];

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
        const res = await get(`?org=${encodeURIComponent(slug)}&format=${format}`);

        expect(res.status).toBe(200);
        const cd = res.headers.get("content-disposition") ?? "";
        expect(cd).not.toBe("");

        // No CR/LF anywhere in the header → no response-splitting / injected second header.
        for (const ch of SPLIT_BYTES) {
          expect(cd).not.toContain(ch);
        }

        // Exactly one well-formed Content-Disposition with a single quoted filename.
        const m = cd.match(
          /^attachment; filename="ascent-usage-(.*?)-\d{4}-\d{2}-\d{2}\.(?:csv|json)"$/,
        );
        expect(m, `filename did not match the expected safe shape: ${cd}`).not.toBeNull();
        const fileSlug = m![1];
        expect(fileSlug).toMatch(/^[a-z0-9-]{1,64}$/); // ONLY safe chars, capped length
        expect(fileSlug).not.toBe("");
        for (const ch of ['"', ";", "/"]) {
          expect(fileSlug).not.toContain(ch);
        }
      });
    }
  }

  it("falls back to the literal 'org' token when the slug reduces to nothing", async () => {
    const res = await get(`?org=${encodeURIComponent("日本")}&format=csv`);
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).toContain('filename="ascent-usage-org-');
  });

  it("preserves a benign slug verbatim (the guard does not mangle legitimate names)", async () => {
    const res = await get(`?org=public&format=json`);
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).toMatch(/filename="ascent-usage-public-\d{4}-\d{2}-\d{2}\.json"/);
  });
});

// ---------------------------------------------------------------------------
// (b) public-org day cap — anonymous-DoS amplification guard.
// days = Math.min(orgLc === "public" ? 90 : 365, Math.max(1, Number(days) || 30)).
describe("GET /api/usage — public-org day-window cap (#5b)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDbConfigured.mockReturnValue(true);
    mockRequireOrgRead.mockResolvedValue(null);
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

  it("lets an authorized non-public org reach the wider 365-day window (the cap is public-only)", async () => {
    const res = await get("?org=acme&days=365");
    expect(res.status).toBe(200);
    expect(daysPassed()).toBe(365);
  });

  it("still caps a non-public org's over-365 request at 365", async () => {
    await get("?org=acme&days=99999");
    expect(daysPassed()).toBe(365);
  });
});
