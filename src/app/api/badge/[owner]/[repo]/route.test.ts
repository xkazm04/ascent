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
