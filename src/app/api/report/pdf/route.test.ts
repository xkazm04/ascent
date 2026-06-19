// Integration test for the Private-tier PDF export route (GET /api/report/pdf). The route is a
// cross-tenant data-egress point: a refactor that fetches a private report with a default/owner org
// instead of the gated org — or that drops/reorders the read gate — would silently turn every
// private report's PDF into an unauthenticated download. These tests pin that contract by mocking
// the auth/authz/db/render boundaries (the `src/app/api/scan/route.test.ts` mock-the-boundaries
// pattern) and asserting the *gated* org equals the *fetched* org, plus every failure branch.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScanReport } from "@/lib/types";

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
vi.mock("@/lib/auth", () => ({ readableOrgForOwner: vi.fn() }));
vi.mock("@/lib/authz", () => ({ requireOrgRead: vi.fn() }));
vi.mock("@/lib/db", () => ({ getScanReportByCommit: vi.fn(), isDbConfigured: vi.fn(() => true) }));
vi.mock("@react-pdf/renderer", () => ({ renderToBuffer: vi.fn() }));
// ReportDocument is irrelevant here — the route passes it to the (mocked) renderToBuffer.
vi.mock("@/lib/pdf/report-document", () => ({ ReportDocument: () => null }));

import { GET } from "./route";
import { readableOrgForOwner } from "@/lib/auth";
import { requireOrgRead } from "@/lib/authz";
import { getScanReportByCommit, isDbConfigured } from "@/lib/db";
import { renderToBuffer } from "@react-pdf/renderer";

const mockReadableOrg = vi.mocked(readableOrgForOwner);
const mockRequireOrgRead = vi.mocked(requireOrgRead);
const mockGetReport = vi.mocked(getScanReportByCommit);
const mockIsDbConfigured = vi.mocked(isDbConfigured);
const mockRender = vi.mocked(renderToBuffer);

const REPORT = { repo: "acme/private-repo", scannedAt: "2026-01-01T00:00:00.000Z" } as unknown as ScanReport;

function get(repo?: string) {
  const url = repo == null ? "http://localhost/api/report/pdf" : `http://localhost/api/report/pdf?repo=${repo}`;
  return GET(new Request(url));
}

describe("GET /api/report/pdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Happy-path defaults; individual tests override what they exercise.
    mockIsDbConfigured.mockReturnValue(true);
    mockReadableOrg.mockResolvedValue("acme"); // member → gated to the real owner org
    mockRequireOrgRead.mockResolvedValue(null); // read allowed
    mockGetReport.mockResolvedValue(REPORT);
    mockRender.mockResolvedValue(Buffer.from("%PDF-1.7 fake"));
  });

  // ── The cross-tenant authorization invariant ──────────────────────────────────────────────────

  it("threads the EXACT gated org from readableOrgForOwner into getScanReportByCommit", async () => {
    mockReadableOrg.mockResolvedValue("acme");
    await get("acme/private-repo@deadbee");

    expect(mockGetReport).toHaveBeenCalledTimes(1);
    const [owner, name, opts] = mockGetReport.mock.calls[0];
    expect(owner).toBe("acme");
    expect(name).toBe("private-repo");
    // THE invariant: the fetch is scoped to the org the gate resolved & approved — not a default/owner.
    expect((opts as { orgSlug?: string }).orgSlug).toBe("acme");
    expect((opts as { headSha?: string }).headSha).toBe("deadbee");
  });

  it("uses the gated 'public' org (not the raw owner) for a non-member's request", async () => {
    // Non-member: readableOrgForOwner downgrades the owner to "public" (auth.ts), and the read gate
    // allows the public funnel. The fetch MUST be scoped to "public" so a private report isn't found.
    mockReadableOrg.mockResolvedValue("public");
    mockRequireOrgRead.mockResolvedValue(null);
    mockGetReport.mockResolvedValue(null); // no PUBLIC report for this private repo
    const res = await get("acme/private-repo");

    expect(mockReadableOrg).toHaveBeenCalledWith("acme");
    const [, , opts] = mockGetReport.mock.calls[0];
    expect((opts as { orgSlug?: string }).orgSlug).toBe("public");
    expect((opts as { orgSlug?: string }).orgSlug).not.toBe("acme");
    expect(res.status).toBe(404); // surfaces as "no data", never the private PDF
  });

  it("passes the gated org to requireOrgRead before any fetch", async () => {
    mockReadableOrg.mockResolvedValue("acme");
    await get("acme/private-repo");
    expect(mockRequireOrgRead).toHaveBeenCalledWith("acme");
  });

  it("returns the gate's denial Response and NEVER fetches when the read gate is closed", async () => {
    const denial = new Response(JSON.stringify({ error: "You don't have access to this organization." }), {
      status: 403,
    });
    mockRequireOrgRead.mockResolvedValue(denial as never);

    const res = await get("acme/private-repo");

    expect(res.status).toBe(403);
    expect(res).toBe(denial); // the handler returns the gate's own Response verbatim
    expect(mockGetReport).not.toHaveBeenCalled(); // no fetch behind a closed gate
    expect(mockRender).not.toHaveBeenCalled();
  });

  // ── Failure branches ──────────────────────────────────────────────────────────────────────────

  it("503 when the database is not configured (and never gates/fetches)", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    const res = await get("acme/private-repo");

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "PDF export requires a database." });
    expect(mockReadableOrg).not.toHaveBeenCalled();
    expect(mockGetReport).not.toHaveBeenCalled();
  });

  it("400 when ?repo is missing", async () => {
    const res = await get(undefined);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing ?repo=owner/name." });
    expect(mockGetReport).not.toHaveBeenCalled();
  });

  it("400 when ?repo has no owner/name slash", async () => {
    for (const bad of ["foo", "foo/", "/foo"]) {
      vi.clearAllMocks();
      mockIsDbConfigured.mockReturnValue(true);
      const res = await get(bad);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid repo. Use owner/name." });
      expect(mockGetReport).not.toHaveBeenCalled();
    }
  });

  it("404 (not a leak) when there is no saved scan for the repo", async () => {
    mockGetReport.mockResolvedValue(null);
    const res = await get("acme/private-repo");

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "No saved scan for this repository yet. Scan it first, then export." });
    // 404 distinguishes "no data" from "wrong tenant" — it must not carry any report content.
    expect(JSON.stringify(body)).not.toContain("score");
    expect(mockRender).not.toHaveBeenCalled();
  });

  it("404 (not 500) when the fetch rejects — the route swallows the DB error", async () => {
    mockGetReport.mockRejectedValue(new Error("db exploded"));
    const res = await get("acme/private-repo");
    expect(res.status).toBe(404);
  });

  it("500 with a clean message (no raw stack) when the PDF render throws", async () => {
    mockRender.mockRejectedValue(new Error("RENDER_INTERNALS at report-document.tsx:88 SECRET_STACK"));
    const res = await get("acme/private-repo");

    expect(res.status).toBe(500);
    const raw = await res.text();
    expect(JSON.parse(raw)).toEqual({ error: "Failed to render the PDF." });
    // The raw stack / internals must never escape into the response body.
    expect(raw).not.toContain("SECRET_STACK");
    expect(raw).not.toContain("report-document.tsx");
    expect(raw.toLowerCase()).not.toContain("stack");
  });

  // ── Success path ──────────────────────────────────────────────────────────────────────────────

  it("200 application/pdf with sanitized attachment filename on the happy path", async () => {
    mockRender.mockResolvedValue(Buffer.from("%PDF-1.7 fake-bytes"));
    const res = await get("acme/private-repo@deadbeefcafe");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toBe('attachment; filename="ascent-acme-private-repo-deadbee.pdf"');
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(0);
  });

  // ── Content-Disposition filename sanitization (header-split / path-traversal) ───────────────────
  // The happy-path test above pins a CLEAN filename. This pins the *security* contract: a crafted
  // owner / name / sha carrying header-injection or path chars (`"`, CR, LF, `;`, `/`, `\`, space,
  // unicode) must be neutralized by the `safe` allowlist before reaching the header value, so it can
  // never split into a second header or escape the quoted filename as a path. `parseRepo` splits on
  // the FIRST slash, so `name` carries everything after it (including further slashes) — and `sha`
  // is caller-supplied & unvalidated — making both attacker-influenced inputs into the header.

  it("neutralizes header-injection / path chars in owner, name, and sha — no CR/LF/quote/slash survives", async () => {
    mockReadableOrg.mockResolvedValue("acme");
    // owner is split before the first '/', so craft injection chars that aren't '/': quote + CRLF + ';'.
    // name keeps everything after the first slash (so it carries '/', backslash, CRLF, quote, space).
    // sha is fully caller-supplied (the unvalidated segment the comment calls out).
    const owner = 'ac"me\r\nX-Injected: 1;';
    const name = 'repo/../../evil"\r\nSet-Cookie: x=1 path\\seg';
    const sha = 'dead"bee\r\n/../traverse;';
    const res = await get(`${encodeURIComponent(owner)}/${name}@${encodeURIComponent(sha)}`);

    expect(res.status).toBe(200);
    const disposition = res.headers.get("content-disposition") ?? "";

    // The whole header is exactly `attachment; filename="ascent-<allowlisted>.pdf"` — the only `;`/
    // quotes present are the route's own literal framing; everything between is [A-Za-z0-9._-].
    expect(disposition).toMatch(/^attachment; filename="ascent-[A-Za-z0-9._-]+\.pdf"$/);

    // Pull out just the attacker-influenced filename VALUE (inside the quotes) and prove every
    // breakout char was stripped — these are the bytes that, if the allowlist loosened, would let the
    // value re-close the quote, add a directive (`;`/`:`), split the header (CR/LF), or traverse a path.
    const value = disposition.match(/^attachment; filename="(.*)"$/)?.[1] ?? "<no-match>";
    for (const bad of ['"', "\r", "\n", ";", ":", "/", "\\", " "]) {
      expect(value).not.toContain(bad);
    }
    // The value is exactly the allowlist — nothing outside [A-Za-z0-9._-] (plus the route's own dashes).
    expect(value).toMatch(/^ascent-[A-Za-z0-9._-]+\.pdf$/);
    // `.` is intentionally allowlisted (real filename dots), but the path SEPARATORS are gone, so a
    // `../../evil` segment can never resolve as a traversal path — only a literal dotted token remains.
    expect(value).not.toMatch(/\.[\\/]/);

    // The full header is a single well-formed line — header injection would create more.
    expect(disposition.split(/\r|\n/)).toHaveLength(1);

    // The runtime can't reject the header (a CR/LF in a header value throws on construction) — proves
    // the sanitized value is actually settable on a Response, not merely string-clean.
    expect(() => new Response("x", { headers: { "content-disposition": disposition } })).not.toThrow();
  });
});
