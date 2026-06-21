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
vi.mock("@/lib/db", () => ({ getOrgBranding: vi.fn(), getTechGroupIdByKey: vi.fn(async () => null), isDbConfigured: vi.fn(() => true) }));
vi.mock("@react-pdf/renderer", () => ({ renderToBuffer: vi.fn() }));
// BriefingDocument is irrelevant here — the route passes it to the (mocked) renderToBuffer.
vi.mock("@/lib/pdf/briefing-document", () => ({ BriefingDocument: () => null }));
// resolveWindow is pure; let the real one run so we don't have to model the route's window plumbing.

import { GET } from "./route";
import { requireOrgRead } from "@/lib/authz";
import { buildExecBriefing } from "@/lib/org/briefing";
import { getOrgBranding, isDbConfigured } from "@/lib/db";
import { renderToBuffer } from "@react-pdf/renderer";

const mockRequireOrgRead = vi.mocked(requireOrgRead);
const mockBuild = vi.mocked(buildExecBriefing);
const mockGetBranding = vi.mocked(getOrgBranding);
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
    // Happy-path defaults; individual tests override what they exercise.
    mockIsDbConfigured.mockReturnValue(true);
    mockRequireOrgRead.mockResolvedValue(null); // read allowed
    mockBuild.mockResolvedValue(BRIEFING);
    mockGetBranding.mockResolvedValue({ logoUrl: "https://cdn.example/logo.png" } as never);
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

  it("404 (not 500) when buildExecBriefing rejects — the route swallows the build error", async () => {
    mockBuild.mockRejectedValue(new Error("rollup db exploded"));
    const res = await get("acme");
    expect(res.status).toBe(404);
    expect(mockRender).not.toHaveBeenCalled();
  });

  // ── Branding-fetch / render degradation ladder ────────────────────────────────────────────────

  it("degrades to a 200 PDF when the branding fetch itself rejects (unbranded)", async () => {
    mockGetBranding.mockRejectedValue(new Error("branding lookup failed"));
    const res = await get("acme");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(mockRender).toHaveBeenCalled(); // a render still happened — branding fetch failure isn't fatal
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
