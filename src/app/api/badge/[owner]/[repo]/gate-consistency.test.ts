// CROSS-SURFACE consistency: the README badge and the CI gate endpoint must return the SAME verdict
// for the same repo (ci-gate Direction 2). This is the test whose absence let them drift: the badge
// evaluated `policyFromParams(...)` only, while /api/gate (and the App check run, and the fleet
// governance view) resolve the org's PERSISTED gate policy first — so a repo could wear a green
// "✓ pass" badge in its README while the merge gate FAILED it against the org's tightened bar.
//
// Unlike route.test.ts (which mocks evaluateGate to drive statuses), this file runs BOTH handlers
// over the REAL scoring module and ONE shared fixture report, mocking only the I/O boundaries. The
// assertion is the invariant itself: badge "✓ pass" ⟺ gate 200, badge "✗ fail" ⟺ gate 422.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScanReport } from "@/lib/types";
import type { GatePolicy } from "@/lib/scoring/gate";

vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));

// No handler may reach GitHub in this file — both read the seeded cache hit.
vi.mock("@/lib/scan", () => ({
  scanRepository: vi.fn(async () => {
    throw new Error("no scan should be needed — both surfaces read the seeded cache");
  }),
  GitHubError: class GitHubError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly status?: number,
    ) {
      super(message);
      this.name = "GitHubError";
    }
  },
}));
vi.mock("@/lib/scan-cache", () => ({
  resolveHeadWithHint: vi.fn(async () => "sha123"),
  lookupPersistedScanByCommit: vi.fn(async () => null),
}));
vi.mock("@/lib/cache", () => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  makeCacheKey: (owner: string, repo: string, llm: boolean, sha: string | null) =>
    `${owner}/${repo}@${sha}::${llm ? "llm" : "mock"}`,
  normalizeRepoName: (s: string) => s.toLowerCase(),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimitRequest: vi.fn(() => ({ ok: true, retryAfterSec: 0 })),
  tooManyRequests: vi.fn(() => new Response("{}", { status: 429 })),
  SCAN_RATE_LIMIT: {},
  GATE_RATE_LIMIT: {},
  BADGE_RATE_LIMIT: {},
}));
vi.mock("@/lib/db", () => ({
  recordBadgeImpression: vi.fn(async () => {}),
  recordQuotaEvent: vi.fn(async () => {}),
}));
vi.mock("@/lib/db/org-gate", () => ({ getOrgGatePolicy: vi.fn(async () => null) }));

import { GET as badgeGET } from "./route";
import { GET as gateGET } from "../../../gate/[owner]/[repo]/route";
import { cacheGet } from "@/lib/cache";
import { getOrgGatePolicy } from "@/lib/db/org-gate";

const mockCacheGet = vi.mocked(cacheGet);
const mockOrgPolicy = vi.mocked(getOrgGatePolicy);

/** One shared fixture: a mid-band repo whose D9 (Security) is the weak dimension. */
function fixture(d9: number): ScanReport {
  return {
    repo: { fullName: "acme/widget", isPrivate: false },
    overallScore: 65,
    level: { id: "L3", name: "Assisted", band: [60, 69], tagline: "", description: "" },
    posture: { id: "governed", label: "Governed" },
    archetype: "service",
    dimensions: [
      { id: "D1", name: "Agent Guidance", weight: 1, score: 70 },
      { id: "D9", name: "Security", weight: 1, score: d9 },
    ],
    engine: { provider: "mock", model: "deterministic-rubric" },
    confidence: 0.9,
    warnings: [],
  } as unknown as ScanReport;
}

async function badge(query = "") {
  const res = await badgeGET(new Request(`http://localhost/api/badge/acme/widget${query}`), {
    params: Promise.resolve({ owner: "acme", repo: "widget" }),
  });
  return res.text();
}

async function gate(query = "") {
  const res = await gateGET(new Request(`http://localhost/api/gate/acme/widget${query}`), {
    params: Promise.resolve({ owner: "acme", repo: "widget" }),
  });
  return res.status;
}

/** The invariant, asserted as one statement over both surfaces. */
async function expectAgreement(pass: boolean, badgeQuery: string, gateQuery: string) {
  const svg = await badge(badgeQuery);
  const status = await gate(gateQuery);
  expect(svg).toContain(pass ? "✓ pass" : "✗ fail");
  expect(svg).not.toContain(pass ? "✗ fail" : "✓ pass");
  expect(status).toBe(pass ? 200 : 422);
}

describe("badge ↔ gate verdict consistency (one fixture, both surfaces)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOrgPolicy.mockResolvedValue(null);
    mockCacheGet.mockReturnValue(fixture(30)); // D9 = 30 (the weak dimension)
  });

  it("ORG POLICY: a D9 floor the repo misses FAILS on both — the badge no longer advertises a green pass", async () => {
    // The exact drift this direction closes: with an org D9 floor of 60 and D9 = 30, /api/gate has
    // always returned 422 — and the badge used to render "✓ pass" (the org policy was invisible to it).
    mockOrgPolicy.mockResolvedValue({ minDimensionFor: { D9: 60 } } as GatePolicy);
    await expectAgreement(false, "?gate=1", "");
  });

  it("ORG POLICY: the same org bar the repo CLEARS passes on both", async () => {
    mockCacheGet.mockReturnValue(fixture(80)); // D9 now above the floor
    mockOrgPolicy.mockResolvedValue({ minDimensionFor: { D9: 60 } } as GatePolicy);
    await expectAgreement(true, "?gate=1", "");
  });

  it("TIGHTEN-ONLY: a lax query param cannot buy a green badge that the gate refuses", async () => {
    // ?min_security=1 would install a floor of 1 if params replaced the org policy. Both surfaces
    // merge tighten-only, so the org's 60 survives on BOTH and the verdict stays red on BOTH.
    mockOrgPolicy.mockResolvedValue({ minDimensionFor: { D9: 60 } } as GatePolicy);
    await expectAgreement(false, "?gate=1&min_security=1", "?min_security=1");
  });

  it("TIGHTEN-ONLY: a stricter query param fails BOTH surfaces (no org policy configured)", async () => {
    mockOrgPolicy.mockResolvedValue(null);
    // No persisted policy → params over the archetype default on both. min_security=60 vs D9 = 30.
    await expectAgreement(false, "?gate=1&min_security=60", "?min_security=60");
  });

  it("NO org policy, no params: the archetype default resolves identically on both surfaces", async () => {
    mockCacheGet.mockReturnValue(fixture(80));
    mockOrgPolicy.mockResolvedValue(null);
    const svg = await badge("?gate=1");
    const status = await gate();
    // Whatever the archetype default decides, the two surfaces must decide it the SAME way.
    expect(svg.includes("✓ pass")).toBe(status === 200);
    expect(svg.includes("✗ fail")).toBe(status === 422);
  });
});
