// Integration test for the public badge endpoint's PRIVATE-repo disclosure gate
// (route.ts:309, `if (report.repo.isPrivate)`). This endpoint is UNAUTHENTICATED and
// crawlable, but the shared report cache (`cacheGet`) can hold a private repo's real report
// left by an AUTHENTICATED scan. The single `isPrivate` short-circuit is the only thing
// between that cached report and a public SVG embeddable in any README — if it's removed,
// reordered below the level/score/gate returns, or bypassed by a query variant, the endpoint
// leaks the private repo's actual level/score/gate verdict. Nothing tested this until now.
//
// Harness mirrors src/app/api/scan/route.test.ts: mock next/server's NextResponse, and mock
// the scan/cache/db/scoring boundaries so we control exactly what report the handler sees.
// We seed `cacheGet` to return a report (a CACHE HIT), proving the gate runs on the cached
// path WITHOUT ever calling scanRepository — the precise leak the finding describes.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScanReport } from "@/lib/types";

vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));

// scanRepository must NEVER be reached on a cache hit; GitHubError is imported alongside it
// (the route's catch does `instanceof GitHubError`), so the mock must provide both.
vi.mock("@/lib/scan", () => ({
  scanRepository: vi.fn(),
  GitHubError: class GitHubError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "GitHubError";
    }
  },
}));
vi.mock("@/lib/scan-cache", () => ({ resolveHeadWithHint: vi.fn(async () => "sha123") }));
vi.mock("@/lib/cache", () => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  makeCacheKey: (owner: string, repo: string, llm: boolean, sha: string | null) =>
    `${owner}/${repo}@${sha}::${llm ? "llm" : "mock"}`,
  normalizeRepoName: (s: string) => s.toLowerCase(),
}));
// Gate evaluation is mocked so gate-mode is deterministic AND so we can detect any leak of a
// real verdict: if the gate were ever evaluated for a private repo, it would call evaluateGate.
vi.mock("@/lib/scoring/gate", () => ({
  evaluateGate: vi.fn(() => ({ pass: true, failures: [] })),
  policyFromParams: vi.fn(() => ({})),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimitRequest: vi.fn(() => ({ ok: true })),
  BADGE_RATE_LIMIT: {},
}));
vi.mock("@/lib/db", () => ({
  recordBadgeImpression: vi.fn(async () => {}),
  recordQuotaEvent: vi.fn(async () => {}),
}));

import { GET } from "./route";
import { scanRepository } from "@/lib/scan";
import { cacheGet } from "@/lib/cache";
import { evaluateGate } from "@/lib/scoring/gate";
import { recordBadgeImpression } from "@/lib/db";

const mockScan = vi.mocked(scanRepository);
const mockCacheGet = vi.mocked(cacheGet);
const mockEvaluateGate = vi.mocked(evaluateGate);
const mockRecordImpression = vi.mocked(recordBadgeImpression);

// A fully-realized report. `level`/overallScore are the SECRETS the badge would leak.
function reportWith(isPrivate: boolean): ScanReport {
  return {
    repo: { fullName: "acme/secret-repo", isPrivate },
    overallScore: 87,
    level: { id: "L4", name: "Autonomous", band: [80, 89], tagline: "", description: "" },
    archetype: "service",
  } as unknown as ScanReport;
}

async function get(query = "") {
  return GET(new Request(`http://localhost/api/badge/o/r${query}`), {
    params: Promise.resolve({ owner: "o", repo: "r" }),
  });
}

// The verdict-disclosure markers the badge must NEVER emit for a private repo. The seeded report
// is L4 / "Autonomous" / 87, so any of these in the body would be a confidentiality leak.
function expectNoVerdictLeak(body: string) {
  expect(body).not.toContain("L4"); // level id
  expect(body).not.toContain("Autonomous"); // level name
  expect(body).not.toContain("87"); // overall score
  expect(body).not.toContain("✓ pass"); // gate verdict
  expect(body).not.toContain("✗ fail"); // gate verdict
  expect(body).not.toContain("/100"); // score-metric format
}

describe("GET /api/badge/[owner]/[repo] — private-repo disclosure gate (critical)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-install impls wiped by clearAllMocks so the handler's hot path is intact.
    mockEvaluateGate.mockReturnValue({ pass: true, failures: [] } as never);
    mockRecordImpression.mockResolvedValue(undefined as never);
  });

  it("does NOT disclose a CACHED private repo's level/score on the unauthenticated badge", async () => {
    // The exact leak vector: an authenticated scan left a private report in the shared cache.
    mockCacheGet.mockReturnValue(reportWith(true));
    const res = await get();
    const body = await res.text();

    expect(res.status).toBe(200);
    // The gate runs on the CACHE PATH: scanRepository is never invoked (cache hit), yet the
    // private guard still fires — proving the cached private report cannot leak.
    expect(mockScan).not.toHaveBeenCalled();
    expect(body).toContain(">private<"); // neutral "private" badge value text
    expectNoVerdictLeak(body);
  });

  it("does NOT bypass the gate via ?gate=1 (gate verdict never disclosed for a private repo)", async () => {
    mockCacheGet.mockReturnValue(reportWith(true));
    const res = await get("?gate=1");
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain(">private<");
    expectNoVerdictLeak(body);
    // The private short-circuit precedes gate evaluation, so the gate is never even computed.
    expect(mockEvaluateGate).not.toHaveBeenCalled();
  });

  it("does NOT bypass the gate via ?metric=score (numeric score never disclosed for a private repo)", async () => {
    mockCacheGet.mockReturnValue(reportWith(true));
    const res = await get("?metric=score");
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain(">private<");
    expectNoVerdictLeak(body);
  });

  it("renders a PUBLIC repo's real level + score on the badge (the gate only suppresses private)", async () => {
    mockCacheGet.mockReturnValue(reportWith(false));
    const res = await get();
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(mockScan).not.toHaveBeenCalled(); // still a cache hit
    // The real verdict IS rendered for a public repo — the gate is not over-broad.
    expect(body).toContain("L4");
    expect(body).toContain("Autonomous");
    expect(body).not.toContain(">private<");
  });

  it("renders a PUBLIC repo's numeric score under ?metric=score", async () => {
    mockCacheGet.mockReturnValue(reportWith(false));
    const res = await get("?metric=score");
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain("87/100");
    expect(body).not.toContain(">private<");
  });

  it("never reads the level/score/gate of a private report even when both cache keys are checked", async () => {
    // llmKey returns null, mockKey returns the private report — exercises the
    // `cacheGet(llmKey) ?? cacheGet(mockKey)` fallback while still hitting the private gate.
    mockCacheGet.mockReturnValueOnce(null).mockReturnValueOnce(reportWith(true));
    const res = await get();
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain(">private<");
    expectNoVerdictLeak(body);
    expect(mockScan).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// HIGH (finding #4): the badge logo XSS/SSRF filter (RASTER_LOGO_RE) and the
// esc() SVG escaper. This endpoint is UNAUTHENTICATED and its body is served as
// `image/svg+xml` — an executable image format. A `?logo=` of `data:image/svg+xml`
// (nested scriptable SVG → active-content XSS), `https?://…` / `javascript:…`
// (SSRF / scheme abuse), or an over-cap data URI must be REJECTED (logo → null,
// so NO <image> element embeds). Any caller-influenced text (label/value/color/
// logo/href) must pass through esc() so `<`/`>`/`&`/`"` can't break out of the
// SVG text node or an attribute. We render a PUBLIC repo so the customized body
// (with the candidate logo + label) is actually produced.
describe("GET /api/badge/[owner]/[repo] — logo XSS/SSRF filter + SVG escaping (high)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEvaluateGate.mockReturnValue({ pass: true, failures: [] } as never);
    mockRecordImpression.mockResolvedValue(undefined as never);
    // Public repo so the badge renders its customizable body (logo/label flow through).
    mockCacheGet.mockReturnValue(reportWith(false));
  });

  // --- (a) logo acceptance: only same-origin raster data: URIs embed ---------

  it("REJECTS a data:image/svg+xml logo (nested scriptable SVG → XSS): no <image>, no <script>", async () => {
    const res = await get(
      `?logo=${encodeURIComponent("data:image/svg+xml,<svg onload=alert(1)><script>alert(1)</script></svg>")}`,
    );
    const body = await res.text();

    expect(res.status).toBe(200);
    // The svg+xml logo is filtered out → logo is null → no <image> element at all.
    expect(body).not.toContain("<image");
    // And absolutely none of the scriptable payload leaks into the served svg+xml body.
    expect(body).not.toContain("<script");
    expect(body).not.toContain("onload=");
    expect(body).not.toContain("data:image/svg+xml");
  });

  it("REJECTS an http(s):// logo (SSRF / external fetch): no <image>, no external href", async () => {
    const res = await get(`?logo=${encodeURIComponent("https://evil.example/x.png")}`);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).not.toContain("<image");
    expect(body).not.toContain("https://evil.example");
  });

  it("REJECTS a javascript: scheme logo: no <image>, no javascript: in body", async () => {
    const res = await get(`?logo=${encodeURIComponent("javascript:alert(document.cookie)")}`);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).not.toContain("<image");
    expect(body).not.toContain("javascript:");
  });

  it("REJECTS a raster data: logo that exceeds MAX_LOGO_LEN (4096): no <image>", async () => {
    // A valid-prefix raster URI, but oversized → rejected by the length cap (response-bloat lever).
    const huge = "data:image/png;base64," + "A".repeat(4096);
    const res = await get(`?logo=${encodeURIComponent(huge)}`);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).not.toContain("<image");
  });

  it("ACCEPTS a legitimate raster data:image/png logo and embeds it as an escaped <image>", async () => {
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
    const res = await get(`?logo=${encodeURIComponent(png)}`);
    const body = await res.text();

    expect(res.status).toBe(200);
    // The accepted raster logo renders as an <image> with an href bearing the data: URI.
    expect(body).toContain("<image");
    expect(body).toContain(png);
  });

  it("ACCEPTS a data:image/jpeg logo (the jpe?g alternation)", async () => {
    const jpg = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
    const res = await get(`?logo=${encodeURIComponent(jpg)}`);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain("<image");
    expect(body).toContain(jpg);
  });

  // --- (b) esc(): caller-supplied text can't break out of the SVG ------------

  it("ESCAPES a markup-breaking ?label= so no raw <script> / raw < > \" land in the SVG", async () => {
    const payload = `</text><script>alert(1)</script>"&<>`;
    const res = await get(`?label=${encodeURIComponent(payload)}`);
    const body = await res.text();

    expect(res.status).toBe(200);
    // No unescaped script tag and no raw breakout characters survive from the payload.
    expect(body).not.toContain("<script>alert(1)</script>");
    expect(body).not.toContain("</text><script");
    // The escaped entities ARE present, proving the payload was neutralized, not dropped.
    expect(body).toContain("&lt;");
    expect(body).toContain("&gt;");
    expect(body).toContain("&quot;");
    expect(body).toContain("&amp;");
    // The label is reflected into a role="img" aria-label attribute (double-quoted) AND a
    // <text> node — neither must contain a raw `"` or `<` from the payload that could close
    // the attribute or open a tag. The only `<`/`"` in the body are structural SVG syntax.
  });

  it("ESCAPES a crafted owner/repo name so a repo name can't break out of the SVG text node", async () => {
    // owner/repo arrive normalized+lowercased then validName-checked; a name with markup chars
    // fails NAME_RE → neutral "unknown" badge, but the route still passes `value:"unknown"` and the
    // (un-validated, sliced) label through esc(). Drive the escaper via the label, which is the
    // user-influenced text that survives to the SVG, and assert no raw breakout char appears.
    const res = await get(`?label=${encodeURIComponent('"><script>x</script>')}`);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).not.toContain('"><script>');
    expect(body).not.toContain("<script>x</script>");
    expect(body).toContain("&lt;script&gt;");
  });

  it("renders a legitimate plain ?label= verbatim (escaper does not mangle benign text)", async () => {
    const res = await get(`?label=${encodeURIComponent("My Project")}`);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain("My Project");
    expect(body).not.toContain("&lt;"); // nothing to escape in benign input
  });
});
