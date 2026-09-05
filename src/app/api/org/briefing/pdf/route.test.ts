// Integration test for the executive-briefing PDF export route (GET /api/org/briefing/pdf). This is
// the downloadable board artifact and the one auth boundary in the executive-briefing context — a
// money/leadership export. A refactor that drops/reorders the `requireOrgRead` gate turns it into a
// cross-tenant IDOR; a regression in the branded→unbranded render fallback 500s the download on a
// benign logo; a regression in the `safe()` filename sanitizer opens a Content-Disposition header
// injection. These tests pin each guard by mocking the auth/briefing/db/render boundaries (the
// `src/app/api/report/pdf/route.test.ts` mock-the-boundaries pattern) and asserting every branch.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExecBriefing } from "@/lib/org/briefing";

// NextResponse stand-in: `static json` for the error/guard exits, and a constructor (subclassing the
// global Response) for the success path's `new NextResponse(bytes, { headers })`.
vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), {
        ...init,
        headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
      });
    }
  },
}));
vi.mock("@/lib/authz", () => ({ requireOrgRead: vi.fn() }));
vi.mock("@/lib/org/briefing", () => ({ buildExecBriefing: vi.fn() }));
// G5-10: the route now resolves its window through the cookie-aware `resolveOrgWindow`, so the
// next/headers cookie store has to exist in this environment. Individual tests set the jar.
const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
  })),
}));
// G5-03: the narrative pass is an explicit opt-in the route makes. It is exercised on its own in
// src/lib/org/briefing-narrative.test.ts; here we only assert the route runs it and hands the
// RESULT to the document (identity pass-through by default so the other assertions are unaffected).
vi.mock("@/lib/org/briefing-narrative", () => ({
  attachBriefingNarrative: vi.fn(async (b: unknown) => b),
}));
vi.mock("@/lib/db", () => ({
  getOrgBranding: vi.fn(),
  getCreditState: vi.fn(),
  getTechGroupIdByKey: vi.fn(async () => null),
  isDbConfigured: vi.fn(() => true),
}));
vi.mock("@react-pdf/renderer", () => ({ renderToBuffer: vi.fn() }));
// The logo SSRF guard does real DNS + fetch; pass the URL through here so the branded-render path stays
// hermetic. Its own guard is covered in src/lib/net/logo-fetch.test.ts.
vi.mock("@/lib/net/logo-fetch", () => ({ resolveSafeLogoDataUri: vi.fn(async (u: string) => u) }));
// BriefingDocument is irrelevant here — the route passes it to the (mocked) renderToBuffer.
vi.mock("@/lib/pdf/briefing-document", () => ({ BriefingDocument: () => null }));
// resolveWindow is pure; let the real one run so we don't have to model the route's window plumbing.

import { GET } from "./route";
import { requireOrgRead } from "@/lib/authz";
import { buildExecBriefing } from "@/lib/org/briefing";
import { getOrgBranding, getCreditState, getTechGroupIdByKey, isDbConfigured } from "@/lib/db";
import { renderToBuffer } from "@react-pdf/renderer";
import { attachBriefingNarrative } from "@/lib/org/briefing-narrative";
import { PERIOD_COOKIE } from "@/lib/window";

const mockRequireOrgRead = vi.mocked(requireOrgRead);
const mockBuild = vi.mocked(buildExecBriefing);
const mockGetBranding = vi.mocked(getOrgBranding);
const mockGetCreditState = vi.mocked(getCreditState);
const mockIsDbConfigured = vi.mocked(isDbConfigured);
const mockRender = vi.mocked(renderToBuffer);

const BRIEFING = { org: "acme", generatedOn: "2026-06-18", periodTitle: "Last 90 days" } as unknown as ExecBriefing;

function get(org?: string) {
  const url = org == null ? "http://localhost/api/org/briefing/pdf" : `http://localhost/api/org/briefing/pdf?org=${encodeURIComponent(org)}`;
  return GET(new Request(url));
}

describe("GET /api/org/briefing/pdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookieJar.clear();
    vi.mocked(attachBriefingNarrative).mockImplementation(async (b) => b);
    // `clearAllMocks` clears calls but NOT implementations, so a `mockResolvedValue("tg_1")` set by
    // one stack-scope test used to leak into every later test's buildExecBriefing args. Re-arm the
    // unscoped default here.
    vi.mocked(getTechGroupIdByKey).mockResolvedValue(null);
    // Happy-path defaults; individual tests override what they exercise.
    mockIsDbConfigured.mockReturnValue(true);
    mockRequireOrgRead.mockResolvedValue(null); // read allowed
    mockBuild.mockResolvedValue(BRIEFING);
    mockGetBranding.mockResolvedValue({ logoUrl: "https://cdn.example/logo.png" } as never);
    // White-label is re-checked at render time against the current plan; default to an entitled plan so
    // the branding-applied assertions below exercise the branded path. Individual tests override.
    mockGetCreditState.mockResolvedValue({ plan: "team" } as never);
    mockRender.mockResolvedValue(Buffer.from("%PDF-1.7 fake-bytes"));
  });

  // ── The cross-tenant authorization invariant ──────────────────────────────────────────────────

  it("gates on requireOrgRead(org) BEFORE building or rendering anything", async () => {
    await get("acme");
    expect(mockRequireOrgRead).toHaveBeenCalledWith("acme");
  });

  it("returns the gate's denial Response verbatim and NEVER builds/renders when read is denied", async () => {
    const denial = new Response(JSON.stringify({ error: "You don't have access to this organization." }), {
      status: 403,
    });
    mockRequireOrgRead.mockResolvedValue(denial as never);

    const res = await get("acme");

    expect(res.status).toBe(403);
    expect(res).toBe(denial); // the handler returns the gate's own Response verbatim
    expect(mockBuild).not.toHaveBeenCalled(); // no briefing build behind a closed gate
    expect(mockRender).not.toHaveBeenCalled(); // no render either
  });

  // ── Failure branches ──────────────────────────────────────────────────────────────────────────

  it("503 when the database is not configured (and never gates/builds)", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    const res = await get("acme");

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Briefing export requires a database." });
    expect(mockRequireOrgRead).not.toHaveBeenCalled();
    expect(mockBuild).not.toHaveBeenCalled();
  });

  it("400 when ?org is missing (and never gates/builds)", async () => {
    const res = await get(undefined);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing ?org." });
    expect(mockRequireOrgRead).not.toHaveBeenCalled();
    expect(mockBuild).not.toHaveBeenCalled();
  });

  it("404 (not a leak) when buildExecBriefing resolves null — no scanned repos", async () => {
    mockBuild.mockResolvedValue(null);
    const res = await get("acme");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "No scanned repositories yet for this organization." });
    expect(mockRender).not.toHaveBeenCalled();
  });

  it("404 (fail closed, never whole-org) when ?stack= is supplied but the key doesn't resolve", async () => {
    // The resolver returns null for a renamed/deleted key or a DB hiccup; the old behavior passed that
    // null through as "no filter" and exported the WHOLE-org briefing under a scoped URL.
    const { getTechGroupIdByKey } = await import("@/lib/db");
    vi.mocked(getTechGroupIdByKey).mockResolvedValue(null);

    const res = await GET(new Request("http://localhost/api/org/briefing/pdf?org=acme&stack=frontend"));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Unknown tech-stack scope for this organization." });
    expect(mockBuild).not.toHaveBeenCalled(); // never builds the unscoped briefing
    expect(mockRender).not.toHaveBeenCalled();
  });

  it("renders scoped (200) when ?stack= resolves to a group id", async () => {
    const { getTechGroupIdByKey } = await import("@/lib/db");
    vi.mocked(getTechGroupIdByKey).mockResolvedValue("tg_1");

    const res = await GET(new Request("http://localhost/api/org/briefing/pdf?org=acme&stack=frontend"));

    expect(res.status).toBe(200);
    expect(mockBuild).toHaveBeenCalledWith("acme", expect.anything(), expect.any(String), null, "tg_1");
  });

  it("404 (not 500) when buildExecBriefing rejects — the route swallows the build error", async () => {
    mockBuild.mockRejectedValue(new Error("rollup db exploded"));
    const res = await get("acme");
    expect(res.status).toBe(404);
    expect(mockRender).not.toHaveBeenCalled();
  });

  // ── G5-10: the window must be resolved the SAME way the Executive page resolves it ────────────
  // The page reads the remembered-period cookie under an explicit ?range=. This route used to call
  // the cookie-blind resolveWindow, so a bookmarked/shared PDF URL with no ?range= silently exported
  // the 90d default while the page beside it showed the org's remembered period.

  it("honours the saved-period cookie when the URL carries no ?range=", async () => {
    cookieJar.set(PERIOD_COOKIE, "30d");
    await get("acme");

    // periodTitle is the observable: the third buildExecBriefing arg.
    expect(mockBuild).toHaveBeenCalledWith("acme", expect.anything(), "Last 30 days", null, null);
  });

  it("honours a remembered CUSTOM range (bounds and title come from the cookie, not the default)", async () => {
    cookieJar.set(PERIOD_COOKIE, "custom|2026-01-01|2026-03-31");
    await get("acme");

    const [, window, title] = mockBuild.mock.calls[0]!;
    expect(title).toBe("2026-01-01 → 2026-03-31");
    // Half-open interval semantics from the canonical time-zone policy: the window starts at the
    // zoned midnight of `from`, and `end` is the last instant of `to`'s calendar day.
    expect((window as { start: Date | null }).start?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect((window as { end: Date | null }).end?.toISOString()).toBe("2026-03-31T23:59:59.999Z");
  });

  it("an explicit ?range= still WINS over the cookie (a shared link stays authoritative)", async () => {
    cookieJar.set(PERIOD_COOKIE, "30d");
    await GET(new Request("http://localhost/api/org/briefing/pdf?org=acme&range=quarter"));

    expect(mockBuild).toHaveBeenCalledWith("acme", expect.anything(), "This quarter", null, null);
  });

  it("falls back to the default period when there is no ?range= and no cookie", async () => {
    await get("acme");
    expect(mockBuild).toHaveBeenCalledWith("acme", expect.anything(), "Last 90 days", null, null);
  });

  it("ignores a malformed period cookie rather than exporting a garbage window", async () => {
    cookieJar.set(PERIOD_COOKIE, "not-a-range");
    await get("acme");
    expect(mockBuild).toHaveBeenCalledWith("acme", expect.anything(), "Last 90 days", null, null);
  });

  // ── G5-03: the narrative pass is applied to the built briefing, before rendering ───────────────

  it("renders the NARRATIVE-ATTACHED briefing, not the raw build result", async () => {
    const withNarrative = { ...BRIEFING, narrative: "Acme stands at 62/100." } as unknown as ExecBriefing;
    vi.mocked(attachBriefingNarrative).mockResolvedValue(withNarrative);

    const res = await get("acme");

    expect(res.status).toBe(200);
    expect(vi.mocked(attachBriefingNarrative)).toHaveBeenCalledWith(BRIEFING);
    // The document receives the attached briefing — the narrative can't be dropped between the two.
    expect(mockRender).toHaveBeenCalled();
    const element = mockRender.mock.calls[0]![0] as unknown as { props: { briefing: ExecBriefing } };
    expect(element.props.briefing).toBe(withNarrative);
  });

  it("never attaches a narrative when there is no briefing to attach it to (404 path)", async () => {
    mockBuild.mockResolvedValue(null);
    const res = await get("acme");

    expect(res.status).toBe(404);
    expect(vi.mocked(attachBriefingNarrative)).not.toHaveBeenCalled();
  });

  // ── Branding-fetch / render degradation ladder ────────────────────────────────────────────────

  it("degrades to a 200 PDF when the branding fetch itself rejects (unbranded)", async () => {
    mockGetBranding.mockRejectedValue(new Error("branding lookup failed"));
    const res = await get("acme");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(mockRender).toHaveBeenCalled(); // a render still happened — branding fetch failure isn't fatal
  });

  it("drops white-label branding (entitlement-leak guard) when the current plan no longer allows it", async () => {
    // Brand set while on Team, but the org has since downgraded to free. The brand columns are never
    // cleared, so an unconditional apply would keep branding the PDF (here, observable via the filename
    // brand slug) after the customer stopped paying. The render-time plan re-check must drop it.
    mockGetBranding.mockResolvedValue({ brandName: "Acme Corp", logoUrl: "https://cdn.example/logo.png" } as never);
    mockGetCreditState.mockResolvedValue({ plan: "free" } as never);

    const res = await get("acme");

    expect(res.status).toBe(200);
    // Unbranded filename: the brand slug fell back to "ascent" because branding was not applied.
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="ascent-briefing-acme-2026-06-18.pdf"');
  });

  it("applies white-label branding (filename uses the brand slug) when the plan allows it", async () => {
    mockGetBranding.mockResolvedValue({ brandName: "Acme Corp", logoUrl: "https://cdn.example/logo.png" } as never);
    mockGetCreditState.mockResolvedValue({ plan: "team" } as never);

    const res = await get("acme");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="acme-corp-briefing-acme-2026-06-18.pdf"');
  });

  it("falls back to an unbranded render (still 200) when the branded render rejects on a bad logo", async () => {
    // Branded render rejects (e.g. unreachable logoUrl); the route retries unbranded and that succeeds.
    mockRender
      .mockRejectedValueOnce(new Error("bad logo image"))
      .mockResolvedValueOnce(Buffer.from("%PDF-1.7 unbranded"));
    const res = await get("acme");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(mockRender).toHaveBeenCalledTimes(2); // branded attempt + unbranded fallback
  });

  it("500 with a clean message (no raw stack) when BOTH renders reject", async () => {
    mockRender.mockRejectedValue(new Error("RENDER_INTERNALS at briefing-document.tsx:88 SECRET_STACK"));
    const res = await get("acme");

    expect(res.status).toBe(500);
    const raw = await res.text();
    expect(JSON.parse(raw)).toEqual({ error: "Failed to render the briefing PDF." });
    // The raw stack / internals must never escape into the response body.
    expect(raw).not.toContain("SECRET_STACK");
    expect(raw).not.toContain("briefing-document.tsx");
    expect(raw.toLowerCase()).not.toContain("stack");
  });

  // ── Success path + filename sanitization ──────────────────────────────────────────────────────

  it("200 application/pdf with a sanitized Content-Disposition filename on the happy path", async () => {
    const res = await get("acme");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="ascent-briefing-acme-2026-06-18.pdf"',
    );
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("strips CR/LF, quotes and slashes from a crafted org slug in the filename (no header injection)", async () => {
    // A slug crafted to break out of the quoted Content-Disposition filename / inject a header.
    mockBuild.mockResolvedValue({ ...BRIEFING, org: 'a"\r\nb/c', generatedOn: "2026-06-18" } as unknown as ExecBriefing);
    const res = await get('a"\r\nb/c');

    expect(res.status).toBe(200);
    const disposition = res.headers.get("content-disposition") ?? "";
    // Inspect the filename VALUE (inside the wrapping quotes) — the sanitizer
    // (replace(/[^A-Za-z0-9._-]/g,"-")) must leave none of these injection chars there.
    const filename = /filename="([^"]*)"/.exec(disposition)?.[1] ?? "";
    for (const c of ['"', "\r", "\n", "/"]) expect(filename).not.toContain(c);
    // a " \r \n b / c  →  a - - - b - c  (each disallowed char becomes one dash).
    expect(disposition).toBe('attachment; filename="ascent-briefing-a---b-c-2026-06-18.pdf"');
  });
});
