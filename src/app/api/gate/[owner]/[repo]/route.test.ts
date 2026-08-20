// Route test for the CI maturity-gate endpoint — the literal 200/422 contract a GitHub Action
// pipes into a merge check (`curl --fail https://…/api/gate/o/r` must exit NON-ZERO on a failing
// gate). This is finding #2 ("Test the gate HTTP endpoint's 200/422 contract") from
// docs/harness/test-mastery-2026-06-18/ci-gate-status-checks.md. There was NO prior test for this
// route; the status-code mapping, the `?mock` parsing, the `?ref=` cache-bypass, and the
// "rate-limit only when !mock" decision were asserted nowhere.
//
// Harness mirrors src/app/api/badge/[owner]/[repo]/route.test.ts: mock next/server's NextResponse,
// and mock the scan / cache / scoring / rate-limit boundaries so we control exactly what report and
// verdict the handler sees. Dynamic params are delivered as a resolved Promise, matching the App
// Router's `ctx.params: Promise<{ owner, repo }>` contract.
//
// THE LOAD-BEARING INVARIANT (the thing CI keys on): `status === 200` IFF `gate.pass === true`,
// and `status === 422` IFF `gate.pass === false`. If a refactor "simplifies" the response to 200
// `{ pass: false }`, these tests go red — which is the entire point.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScanReport } from "@/lib/types";

vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));

// scanRepository is the scan boundary; GitHubError is re-exported alongside it from @/lib/scan, and
// the not-found case throws `new GitHubError("NOT_FOUND", msg, 404)`. Provide both so the route's
// imports resolve and so we can simulate a missing/unscanned repo.
vi.mock("@/lib/scan", () => ({
  scanRepository: vi.fn(),
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
// scan-cache supplies BOTH the conditional head resolve and the DB (cross-instance) tier probe.
// lookupPersistedScanByCommit defaults to a MISS so every pre-existing test keeps its exact
// cache-miss → ingest behavior; the warm-DB tests below opt in per-case.
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
// Gate evaluation is mocked so we drive pass/fail deterministically and can assert that the route's
// status maps off `gate.pass` exactly. policyFromParams is mocked to a spy so we can assert query
// params reach it; explicitPolicyFromParams / tightenGatePolicy stay REAL so the tighten-only org
// policy merge (ci-gate 2026-07-16 #1) is exercised end-to-end through the route.
vi.mock("@/lib/scoring/gate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scoring/gate")>()),
  evaluateGate: vi.fn(),
  policyFromParams: vi.fn(() => ({ minLevel: "L3", minDimension: 40 })),
}));
// The persisted org gate policy — null by default (DB-less), overridden per-test for the merge cases.
vi.mock("@/lib/db/org-gate", () => ({ getOrgGatePolicy: vi.fn(async () => null) }));
// `tooManyRequests` is a SPY WRAPPING THE REAL HELPER, not a stand-in: the route now hands it the
// whole RateLimitResult, and the point of that change is the body/headers it produces, so a stub
// would assert only that the route calls something.
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    rateLimitRequest: vi.fn(() => ({ ok: true, retryAfterSec: 0 })),
    rateLimitRequestShared: vi.fn(async () => ({ ok: true, retryAfterSec: 0 })),
    tooManyRequests: vi.fn(actual.tooManyRequests),
    SCAN_RATE_LIMIT: {},
    GATE_RATE_LIMIT: {},
  };
});

import { GET } from "./route";
import { lookupPersistedScanByCommit } from "@/lib/scan-cache";
import { scanRepository } from "@/lib/scan";
import { cacheGet, cacheSet } from "@/lib/cache";
import { evaluateGate, policyFromParams } from "@/lib/scoring/gate";
import { getOrgGatePolicy } from "@/lib/db/org-gate";
import { rateLimitRequest, rateLimitRequestShared, tooManyRequests } from "@/lib/rate-limit";

const mockScan = vi.mocked(scanRepository);
const mockPersisted = vi.mocked(lookupPersistedScanByCommit);
const mockCacheGet = vi.mocked(cacheGet);
const mockCacheSet = vi.mocked(cacheSet);
const mockEvaluateGate = vi.mocked(evaluateGate);
const mockPolicyFromParams = vi.mocked(policyFromParams);
const mockGetOrgGatePolicy = vi.mocked(getOrgGatePolicy);
const mockRateLimit = vi.mocked(rateLimitRequest);
// The !mock (real-LLM) branch pays the CROSS-INSTANCE ceiling (G1-04); the GATE_RATE_LIMIT ingest
// branches below stay on the in-memory limiter, so the two mocks are asserted separately.
const mockRateLimitShared = vi.mocked(rateLimitRequestShared);
const mockTooManyRequests = vi.mocked(tooManyRequests);

// A minimal-but-realistic report the route reads (.level.id / .overallScore / .posture.id /
// .archetype). The gate verdict is supplied independently via evaluateGate's mock.
function report(): ScanReport {
  return {
    repo: { fullName: "acme/widget", isPrivate: false },
    overallScore: 72,
    level: { id: "L3" },
    posture: { id: "governed" },
    archetype: "org",
    // A genuine AI-graded scan: a real provider, high coverage, no reliability caveats. The route's
    // degraded guard keys on engine.provider === "mock", so a real provider here keeps every existing
    // test on the healthy 200/422 path. These fields (engine/confidence/warnings) are now surfaced in
    // the JSON body so a CI consumer can tell a degraded verdict from a real one (ci-gate #2).
    engine: { provider: "claude-cli", model: "claude-opus" },
    confidence: 0.92,
    warnings: [],
  } as unknown as ScanReport;
}

// A scan that fell back to the deterministic MockProvider (LLM unavailable) — engine.provider "mock"
// plus the "AI analysis was unavailable" caveat. Combined with a ?mock=0 request this is the degraded
// case the honesty guard must NOT let silently PASS.
function degradedReport(): ScanReport {
  return {
    ...report(),
    engine: { provider: "mock", model: "deterministic" },
    confidence: 0.4,
    warnings: [
      "AI analysis was unavailable, so scores reflect detected signals only (no qualitative nuance).",
    ],
  } as unknown as ScanReport;
}

async function get(query = "", owner = "acme", repo = "widget") {
  return GET(new Request(`http://localhost/api/gate/${owner}/${repo}${query}`), {
    params: Promise.resolve({ owner, repo }),
  });
}

describe("GET /api/gate/[owner]/[repo] — the 200/422 CI contract (high)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default warm state: a cache HIT with a report, rate limit OK, policy resolved.
    mockCacheGet.mockReturnValue(report());
    mockRateLimit.mockReturnValue({ ok: true, retryAfterSec: 0 });
    mockRateLimitShared.mockResolvedValue({ ok: true, retryAfterSec: 0 });
    mockPolicyFromParams.mockReturnValue({ minLevel: "L3", minDimension: 40 } as never);
    mockGetOrgGatePolicy.mockResolvedValue(null);
    mockPersisted.mockResolvedValue(null); // DB tier misses by default (see the warm-DB describe below)
  });

  // --- (1) PASS -> 200 with the documented pass body --------------------------
  it("returns HTTP 200 and pass:true when the gate PASSES the threshold", async () => {
    mockEvaluateGate.mockReturnValue({
      pass: true,
      policy: { minLevel: "L3", minDimension: 40 },
      failures: [],
    } as never);

    const res = await get();
    const body = await res.json();

    expect(res.status).toBe(200); // the CI "green" status — curl --fail exits 0
    expect(body.pass).toBe(true);
    // Documented pass body carries the verdict + scored facts CI/badges render.
    expect(body.repo).toBe("acme/widget");
    expect(body.level).toBe("L3");
    expect(body.overallScore).toBe(72);
    expect(body.posture).toBe("governed");
    expect(body.archetype).toBe("org");
    expect(body.ref).toBeNull();
    expect(body.failures).toEqual([]);
  });

  // --- (2) FAIL -> 422 with the documented fail body --------------------------
  it("returns HTTP 422 (the blocking status CI keys on) and pass:false with failures when the gate FAILS", async () => {
    mockEvaluateGate.mockReturnValue({
      pass: false,
      policy: { minLevel: "L3", minDimension: 40 },
      failures: [
        { code: "dimension", message: "D9 Security scored 12, below the required 40." },
        { code: "level", message: "Repo is L2, below the required L3." },
      ],
    } as never);

    const res = await get();
    const body = await res.json();

    expect(res.status).toBe(422); // NON-2xx → `curl --fail` exits non-zero → CI blocks the merge
    expect(body.pass).toBe(false);
    expect(Array.isArray(body.failures)).toBe(true);
    expect(body.failures.length).toBeGreaterThan(0);
    // The fail body documents WHY (score/threshold/reasons) so the PR comment can explain the block.
    expect(body.failures[0].code).toBe("dimension");
    expect(body.policy).toEqual({ minLevel: "L3", minDimension: 40 });
  });

  // --- the load-bearing invariant, stated directly: status === 200 IFF pass ---
  it("INVARIANT: status is 200 exactly when gate.pass is true, 422 exactly when false", async () => {
    mockEvaluateGate.mockReturnValue({ pass: true, policy: {}, failures: [] } as never);
    expect((await get()).status).toBe(200);

    mockEvaluateGate.mockReturnValue({
      pass: false,
      policy: {},
      failures: [{ code: "overall", message: "x" }],
    } as never);
    expect((await get()).status).toBe(422);
  });

  // --- (3) missing / unscanned repo -------------------------------------------
  // The invariant CI relies on: a repo that can't be scanned must NOT return a misleading PASS.
  // scanRepository throws GitHubError("NOT_FOUND", …, 404) for a missing/private repo. The current
  // handler funnels every thrown error through one catch → HTTP 500 with an `error` body. That is
  // emphatically NOT a 200 pass (the dangerous failure mode), so CI still blocks. We pin the ACTUAL
  // behavior: a non-2xx error status + an `error` body + NO `pass:true` leak. (The finding's stated
  // ideal is a dedicated 404; the route returns 500 today — both satisfy "not a misleading pass".)
  it("does NOT return a misleading pass for a missing/unscanned repo — errors out non-2xx, never pass:true", async () => {
    mockCacheGet.mockReturnValue(undefined); // cache MISS → route calls scanRepository
    const { GitHubError } = (await import("@/lib/scan")) as unknown as {
      GitHubError: new (code: string, msg: string, status?: number) => Error;
    };
    mockScan.mockRejectedValue(new GitHubError("NOT_FOUND", "Repository not found or is private.", 404));

    const res = await get();
    const body = await res.json();

    expect(res.status).not.toBe(200); // crucially NOT a green gate
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(body.pass).not.toBe(true); // no false "pass" verdict on an unscannable repo
    expect(body.error).toBeTruthy(); // an error body, not a verdict
    expect(mockEvaluateGate).not.toHaveBeenCalled(); // never evaluated a verdict
  });

  // --- a generic thrown scan -> 500 error body --------------------------------
  it("returns HTTP 500 with an error body when the scan throws unexpectedly", async () => {
    mockCacheGet.mockReturnValue(undefined);
    mockScan.mockRejectedValue(new Error("boom"));

    const res = await get();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBeTruthy();
    expect(body.pass).toBeUndefined();
  });

  // --- (4a) ?mock=0 honors the rate limiter; default mock does NOT ------------
  it("default (mock) gate does NOT rate-limit — the cheap deterministic CI path stays unthrottled", async () => {
    mockEvaluateGate.mockReturnValue({ pass: true, policy: {}, failures: [] } as never);

    const res = await get(); // no ?mock → mock=true
    expect(res.status).toBe(200);
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockRateLimitShared).not.toHaveBeenCalled();
    expect(mockTooManyRequests).not.toHaveBeenCalled();
  });

  it("?mock=0 (real LLM) invokes the shared rate limiter and returns 429 (tooManyRequests) when rl.ok is false", async () => {
    mockRateLimitShared.mockResolvedValue({ ok: false, retryAfterSec: 30 });

    const res = await get("?mock=0");

    expect(mockRateLimitShared).toHaveBeenCalledTimes(1);
    // The WHOLE result is handed to the renderer now, not just the delay — that is what lets the
    // 429 name the layer that refused (asserted in its own suite below).
    expect(mockTooManyRequests).toHaveBeenCalledWith(expect.objectContaining({ ok: false, retryAfterSec: 30 }));
    expect(res.status).toBe(429);
    // Short-circuited BEFORE scanning/evaluating — no LLM budget spent on a throttled request.
    expect(mockScan).not.toHaveBeenCalled();
    expect(mockEvaluateGate).not.toHaveBeenCalled();
  });

  it("?mock=false is also treated as the real-LLM path (rate-limited)", async () => {
    mockEvaluateGate.mockReturnValue({ pass: true, policy: {}, failures: [] } as never);
    await get("?mock=false");
    expect(mockRateLimitShared).toHaveBeenCalledTimes(1);
  });

  it("?mock=0 with rl.ok=true proceeds to evaluate and returns 200 on a pass", async () => {
    mockRateLimitShared.mockResolvedValue({ ok: true, retryAfterSec: 0 });
    mockEvaluateGate.mockReturnValue({ pass: true, policy: {}, failures: [] } as never);

    const res = await get("?mock=0");
    expect(mockRateLimitShared).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });

  // --- (4b) ?ref=sha scopes the scan AND bypasses the cache -------------------
  it("?ref=<sha> calls scanRepository with { mock, ref } and bypasses the cache (no cacheGet/cacheSet)", async () => {
    mockScan.mockResolvedValue(report());
    mockEvaluateGate.mockReturnValue({ pass: true, policy: {}, failures: [] } as never);

    const res = await get("?ref=deadbeef");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ref).toBe("deadbeef"); // the fail/pass body echoes the gated ref
    // Ref-scoped path scores the requested ref directly — never touches the default-branch cache.
    expect(mockCacheGet).not.toHaveBeenCalled();
    expect(mockCacheSet).not.toHaveBeenCalled();
    expect(mockScan).toHaveBeenCalledTimes(1);
    // noAmbientToken: this endpoint is unauthenticated, so an ingest must never run against the
    // operator PAT (which would expose private repos' verdicts to anonymous callers).
    expect(mockScan).toHaveBeenCalledWith("acme/widget", { mock: true, ref: "deadbeef", noAmbientToken: true });
  });

  // --- the non-ref path keys the cache and only scans on a miss ---------------
  it("non-ref path returns the CACHED report without scanning (cache hit)", async () => {
    mockCacheGet.mockReturnValue(report());
    mockEvaluateGate.mockReturnValue({ pass: true, policy: {}, failures: [] } as never);

    const res = await get();
    expect(res.status).toBe(200);
    expect(mockCacheGet).toHaveBeenCalledTimes(1);
    expect(mockScan).not.toHaveBeenCalled(); // cache hit → no scan
  });

  it("SECURITY: no ingest path may ever run against the ambient operator PAT", async () => {
    // ci-gate-status-checks #1. This endpoint is unauthenticated by design (CI calls it with curl).
    // scanRepository falls back to process.env.GITHUB_TOKEN unless noAmbientToken is set, so omitting
    // it let anonymous callers enumerate PRIVATE repos' gate verdicts through the operator's
    // credentials. Assert the invariant over EVERY scan call, on both the ref and cache-miss paths.
    mockCacheGet.mockReturnValue(undefined);
    mockScan.mockResolvedValue(report());
    mockEvaluateGate.mockReturnValue({ pass: true, policy: {}, failures: [] } as never);

    await get();
    await get("?ref=deadbeef");

    expect(mockScan).toHaveBeenCalledTimes(2);
    for (const [, opts] of mockScan.mock.calls) {
      expect(opts?.noAmbientToken).toBe(true);
      expect(opts?.token).toBeUndefined();
    }
  });

  it("non-ref path scans and populates the cache on a miss", async () => {
    mockCacheGet.mockReturnValue(undefined);
    mockScan.mockResolvedValue(report());
    mockEvaluateGate.mockReturnValue({ pass: true, policy: {}, failures: [] } as never);

    const res = await get();
    expect(res.status).toBe(200);
    expect(mockScan).toHaveBeenCalledWith("acme/widget", { mock: true, noAmbientToken: true });
    expect(mockCacheSet).toHaveBeenCalledTimes(1); // write-through after a miss
  });

  // --- (5) query params reach policyFromParams (auth/threshold honored) -------
  it("forwards the URL query params + report archetype to policyFromParams", async () => {
    mockEvaluateGate.mockReturnValue({ pass: true, policy: {}, failures: [] } as never);

    await get("?min_level=L4&min_dimension=50&no_ungoverned=1");

    expect(mockPolicyFromParams).toHaveBeenCalledTimes(1);
    const [params, archetype] = mockPolicyFromParams.mock.calls[0];
    expect(params).toBeInstanceOf(URLSearchParams);
    expect((params as URLSearchParams).get("min_level")).toBe("L4");
    expect((params as URLSearchParams).get("min_dimension")).toBe("50");
    expect((params as URLSearchParams).get("no_ungoverned")).toBe("1");
    expect(archetype).toBe("org"); // policy is archetype-aware off the scanned report
  });

  // --- (5b) TIGHTEN-ONLY org-policy merge (ambiguity-ui 2026-07-16 ci-gate #1) --
  // The endpoint is unauthenticated; a query param must never WEAKEN or drop the persisted org bar.
  // Previously ANY single policy param replaced the entire persisted policy with params + archetype
  // defaults — an anonymous caller could pass ?min_dimension=1 for a green verdict the org never set.
  it("a query param can NOT weaken the persisted org policy (stricter org field survives)", async () => {
    mockGetOrgGatePolicy.mockResolvedValue({
      minOverall: 70,
      minDimensionFor: { D9: 70 },
      requireProtectedBranch: true,
    });
    mockEvaluateGate.mockReturnValue({ pass: true, policy: {}, failures: [] } as never);

    await get("?min_overall=10");

    const [, policy] = mockEvaluateGate.mock.calls[0];
    // The lax param is discarded; every persisted field survives untouched.
    expect(policy).toEqual({ minOverall: 70, minDimensionFor: { D9: 70 }, requireProtectedBranch: true });
    // Archetype defaults never dilute an existing org policy (the old full-replacement path is gone).
    expect(mockPolicyFromParams).not.toHaveBeenCalled();
  });

  it("a query param CAN tighten the persisted org policy per-field (other fields kept)", async () => {
    mockGetOrgGatePolicy.mockResolvedValue({ minOverall: 50, minDimensionFor: { D9: 70 } });
    mockEvaluateGate.mockReturnValue({ pass: true, policy: {}, failures: [] } as never);

    await get("?min_overall=90&min_level=L4");

    const [, policy] = mockEvaluateGate.mock.calls[0];
    expect(policy).toEqual({ minLevel: "L4", minOverall: 90, minDimensionFor: { D9: 70 } });
  });

  it("without a persisted org policy, params + archetype default resolve via policyFromParams (unchanged)", async () => {
    mockGetOrgGatePolicy.mockResolvedValue(null);
    mockEvaluateGate.mockReturnValue({ pass: true, policy: {}, failures: [] } as never);

    await get("?min_overall=60");

    expect(mockPolicyFromParams).toHaveBeenCalledTimes(1);
    const [, policy] = mockEvaluateGate.mock.calls[0];
    expect(policy).toEqual({ minLevel: "L3", minDimension: 40 }); // the policyFromParams spy's return
  });

  // A READ ERROR is not "no policy configured". getOrgGatePolicy returns null (no throw) for every
  // legitimate unset case, so a rejection means the bar is UNKNOWN — and gating on the archetype
  // default there would silently relax an org's configured merge bar for the length of a DB blip.
  it("FAIL-CLOSED: a failing org-policy read returns 503 instead of gating on the archetype default", async () => {
    mockGetOrgGatePolicy.mockRejectedValueOnce(new Error("connection terminated"));
    mockEvaluateGate.mockReturnValue({ pass: true, policy: {}, failures: [] } as never);

    const res = await get();
    const body = await res.json();

    expect(res.status).toBe(503); // never a 200 the org's real bar would have refused
    expect(body.pass).toBeUndefined(); // no verdict is claimed at all
    expect(body.error).toMatch(/could not be read/i);
    expect(mockEvaluateGate).not.toHaveBeenCalled(); // we never evaluate against a bar we couldn't read
  });

  it("an UNSET org policy (null, the DB-less / unknown-org case) still resolves via params — unchanged", async () => {
    mockGetOrgGatePolicy.mockResolvedValueOnce(null);
    mockEvaluateGate.mockReturnValue({ pass: true, policy: {}, failures: [] } as never);

    const res = await get("?min_level=L4");

    expect(res.status).toBe(200);
    expect(mockPolicyFromParams).toHaveBeenCalled(); // the archetype-default path, exactly as before
  });

  // --- (6) DEGRADATION HONESTY (ci-gate-status-checks #2) ----------------------
  // The dangerous failure mode: a caller asks for the real AI grade (?mock=0), the LLM is unavailable,
  // scanRepository degrades to the deterministic MockProvider, and evaluateGate (which reads only
  // scores) still returns pass:true. The endpoint must NOT surface that as a confident 200 pass — CI
  // would merge on a fabricated floor score, indistinguishable from a genuine AI-graded pass.
  it("DEGRADED: a ?mock=0 scan that fell back to the mock engine must NOT yield a silent 200 pass", async () => {
    mockRateLimit.mockReturnValue({ ok: true, retryAfterSec: 0 });
    mockCacheGet.mockReturnValue(undefined); // cache MISS → route scans
    mockScan.mockResolvedValue(degradedReport()); // LLM unavailable → deterministic mock fallback
    mockEvaluateGate.mockReturnValue({ pass: true, policy: {}, failures: [] } as never); // floor "passes"

    const res = await get("?mock=0");
    const body = await res.json();

    expect(res.status).not.toBe(200); // crucially NOT a green gate — curl --fail must trip
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBe(503); // "the requested authoritative grade could not be produced"
    expect(body.degraded).toBe(true); // machine-readable honesty flag a CI consumer can branch on
    // The signals that were omitted before are now present so a degraded verdict is legible.
    expect(body.engine.provider).toBe("mock"); // the grader that actually ran (the deterministic floor)
    expect(body.warnings.length).toBeGreaterThan(0); // the "AI analysis was unavailable" caveat is surfaced
  });

  it("DEGRADED: even a degraded scan whose gate math FAILS returns 503 (not 422) + degraded:true", async () => {
    // A degraded verdict is untrustworthy in BOTH directions; fail closed uniformly so the status says
    // "could not produce the grade" rather than implying the repo genuinely failed the bar.
    mockRateLimit.mockReturnValue({ ok: true, retryAfterSec: 0 });
    mockCacheGet.mockReturnValue(undefined);
    mockScan.mockResolvedValue(degradedReport());
    mockEvaluateGate.mockReturnValue({
      pass: false,
      policy: {},
      failures: [{ code: "overall", message: "x" }],
    } as never);

    const res = await get("?mock=0");
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.degraded).toBe(true);
    expect(body.pass).toBe(false); // the underlying verdict is still in the body for context
  });

  // The wedge this guard exists to prevent: a degraded report cached under the ::llm key makes EVERY
  // later ?mock=0 call on that commit a cache HIT, so the route re-serves the floor score, 503s again,
  // and never re-scans — for the whole 15-minute TTL. The response tells the operator to retry, so the
  // bug presents as "retrying does nothing" long after the provider recovered.
  it("DEGRADED: the fallback-to-mock report is NOT cached — a retry re-scans instead of re-serving the floor", async () => {
    mockRateLimit.mockReturnValue({ ok: true, retryAfterSec: 0 });
    mockCacheGet.mockReturnValue(undefined); // cache MISS → route scans
    mockScan.mockResolvedValue(degradedReport()); // LLM unavailable → deterministic mock fallback
    mockEvaluateGate.mockReturnValue({ pass: true, policy: {}, failures: [] } as never);

    const res = await get("?mock=0");

    expect(res.status).toBe(503);
    expect(mockCacheSet).not.toHaveBeenCalled(); // the ::llm entry stays empty, so the next call re-scans
  });

  it("a HEALTHY ?mock=0 scan IS still cached (the guard is scoped to degradation, not to the LLM path)", async () => {
    mockRateLimit.mockReturnValue({ ok: true, retryAfterSec: 0 });
    mockCacheGet.mockReturnValue(undefined);
    mockScan.mockResolvedValue(report()); // a real provider answered — authoritative, cache it
    mockEvaluateGate.mockReturnValue({ pass: true, policy: {}, failures: [] } as never);

    const res = await get("?mock=0");

    expect(res.status).toBe(200);
    expect(mockCacheSet).toHaveBeenCalledWith("acme/widget@sha123::llm", expect.anything());
  });

  // The other half of the contract: the DEFAULT gate path runs the deterministic mock scan BY DESIGN
  // (documented behavior). engine.provider === "mock" here is EXPECTED, not a fallback — the guard keys
  // on `!mock`, so a default gate stays a normal 200-pass / 422-fail and the deterministic CI contract
  // is untouched. This is the regression that a naive "mock engine ⇒ degraded" check would introduce.
  it("DEFAULT (mock=true) with the mock engine is the documented deterministic rubric — NOT degraded, keeps 200", async () => {
    mockCacheGet.mockReturnValue(degradedReport()); // engine.provider === "mock", but the request IS mock
    mockEvaluateGate.mockReturnValue({ pass: true, policy: {}, failures: [] } as never);

    const res = await get(); // no ?mock → mock=true (the default deterministic path)
    const body = await res.json();

    expect(res.status).toBe(200); // deterministic default gate is authoritative for what it claims to be
    expect(body.pass).toBe(true);
    expect(body.degraded).toBe(false);
    expect(body.engine.provider).toBe("mock"); // surfaced + honestly labeled, but not flagged degraded
  });

  it("surfaces engine / confidence / warnings / degraded on a HEALTHY pass (context for every consumer)", async () => {
    mockEvaluateGate.mockReturnValue({ pass: true, policy: {}, failures: [] } as never);

    const res = await get(); // healthy report() from beforeEach: real provider, high coverage
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.degraded).toBe(false);
    expect(body.engine).toEqual({ provider: "claude-cli", model: "claude-opus" });
    expect(body.confidence).toBe(0.92);
    expect(Array.isArray(body.warnings)).toBe(true);
    expect(body.warnings).toEqual([]);
  });
});

// --- WARM PR GATES FROM THE DB TIER (ci-gate Direction 1) ---------------------
// Every cold serverless instance used to re-ingest the whole repo: the gate's only cache was
// per-instance memory, while the cross-instance DB tier /api/scan already writes (and that the App
// webhook has usually just populated for this very sha) was never consulted. The route now probes it
// between the memory tier and the ingest — keyed on the EXACT sha + requested mode, behind the same
// identity/freshness guards (unit-pinned in src/lib/scan-cache.test.ts). Here we pin the ROUTE's
// wiring: what it passes, when it skips the ingest, and that a miss is byte-identical to before.
describe("GET /api/gate — warm DB tier (no cold-start re-ingest)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRateLimit.mockReturnValue({ ok: true, retryAfterSec: 0 });
    mockGetOrgGatePolicy.mockResolvedValue(null);
    mockPolicyFromParams.mockReturnValue({ minLevel: "L3", minDimension: 40 } as never);
    mockEvaluateGate.mockReturnValue({ pass: true, policy: {}, failures: [] } as never);
    mockCacheGet.mockReturnValue(undefined); // memory tier COLD for every case here
    mockPersisted.mockResolvedValue(null);
    mockScan.mockResolvedValue(report());
  });

  it("HEAD PATH — a DB hit for the resolved head sha serves the verdict WITHOUT ingesting", async () => {
    mockPersisted.mockResolvedValue(report());

    const res = await get();

    expect(res.status).toBe(200);
    expect(mockScan).not.toHaveBeenCalled(); // the whole point: no repo ingest on a cold instance
    // Probed with the resolved head sha and the REQUESTED mode (useLLM = !mock), so a default gate can
    // never be answered by an LLM-scored row (that would make the deterministic verdict stochastic).
    expect(mockPersisted).toHaveBeenCalledWith({ owner: "acme", repo: "widget", headSha: "sha123", useLLM: false });
    expect(mockCacheSet).toHaveBeenCalledTimes(1); // warms the in-memory tier for the next reader
    // A warm hit spends neither LLM budget nor a GitHub ingest, so it is classified with the warm
    // MEMORY hit: unthrottled. Otherwise the same PR could 429 on a cold instance and pass on a warm one.
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it("HEAD PATH — the in-memory tier stays IN FRONT (a memory hit never touches the DB)", async () => {
    mockCacheGet.mockReturnValue(report());

    const res = await get();

    expect(res.status).toBe(200);
    expect(mockPersisted).not.toHaveBeenCalled();
    expect(mockScan).not.toHaveBeenCalled();
  });

  it("HEAD PATH — a DB MISS is byte-identical to today: rate-limited, then a fresh ingest", async () => {
    const res = await get();

    expect(res.status).toBe(200);
    expect(mockPersisted).toHaveBeenCalledTimes(1);
    expect(mockScan).toHaveBeenCalledWith("acme/widget", { mock: true, noAmbientToken: true });
    expect(mockRateLimit).toHaveBeenCalledTimes(1); // the ingest branch still pays GATE_RATE_LIMIT
    expect(mockCacheSet).toHaveBeenCalledTimes(1);
  });

  it("?mock=0 probes the DB tier with useLLM:true (mode is part of the key)", async () => {
    await get("?mock=0");
    expect(mockPersisted).toHaveBeenCalledWith({ owner: "acme", repo: "widget", headSha: "sha123", useLLM: true });
  });

  const SHA = "0".repeat(39) + "a"; // a full 40-hex commit sha

  it("REF PATH — a DB hit for the EXACT requested sha skips the ingest (the warm PR gate)", async () => {
    mockPersisted.mockResolvedValue(report());

    const res = await get(`?ref=${SHA}`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ref).toBe(SHA); // the body still echoes the gated ref
    expect(mockScan).not.toHaveBeenCalled();
    expect(mockPersisted).toHaveBeenCalledWith({ owner: "acme", repo: "widget", headSha: SHA, useLLM: false });
    expect(mockRateLimit).not.toHaveBeenCalled(); // no ingest → no throttle, as on the head path
  });

  it("REF PATH — a DB miss falls back to today's exact behavior (throttle, then a ref-scoped ingest)", async () => {
    const res = await get(`?ref=${SHA}`);

    expect(res.status).toBe(200);
    expect(mockScan).toHaveBeenCalledWith("acme/widget", { mock: true, ref: SHA, noAmbientToken: true });
    expect(mockRateLimit).toHaveBeenCalledTimes(1);
  });

  it("REF PATH — a BRANCH name is never probed (not a commit key) and ingests as before", async () => {
    const res = await get("?ref=main");

    expect(res.status).toBe(200);
    expect(mockPersisted).not.toHaveBeenCalled();
    expect(mockScan).toHaveBeenCalledWith("acme/widget", { mock: true, ref: "main", noAmbientToken: true });
  });
});

// A CI gate that 429s must say WHY, or the pipeline owner has no move but to retry blind. The three
// refusals are genuinely different advice: your own budget (slow down, here is the budget), the
// fleet budget (slowing down may not clear it), and "not evaluated" (the shared limiter never
// answered — nothing of yours was counted).
describe("GET /api/gate/[owner]/[repo] — the 429 names the scope that refused", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCacheGet.mockReturnValue(report());
    mockRateLimit.mockReturnValue({ ok: true, retryAfterSec: 0 });
    mockRateLimitShared.mockResolvedValue({ ok: true, retryAfterSec: 0 });
    mockGetOrgGatePolicy.mockResolvedValue(null);
    mockPolicyFromParams.mockReturnValue({ minLevel: "L3", minDimension: 40 } as never);
  });

  it("?mock=0 — a per-IP refusal states scope, limiter, budget and window", async () => {
    mockRateLimitShared.mockResolvedValue({
      ok: false,
      retryAfterSec: 30,
      scope: "ip",
      limiter: "scan",
      limit: 5,
      windowSec: 60,
      evaluated: true,
    });

    const res = await get("?mock=0");

    expect(res.status).toBe(429);
    expect(res.headers.get("x-ascent-ratelimit-scope")).toBe("ip");
    expect(res.headers.get("x-ascent-ratelimit-limit")).toBe("5");
    expect(res.headers.get("x-ascent-ratelimit-window")).toBe("60");
    expect(await res.json()).toMatchObject({ code: "rate_limited", scope: "ip", limiter: "scan", limit: 5, windowSec: 60 });
  });

  it("?mock=0 — a GLOBAL refusal names the scope but never discloses the fleet ceiling", async () => {
    mockRateLimitShared.mockResolvedValue({
      ok: false,
      retryAfterSec: 20,
      scope: "global",
      limiter: "scan",
      evaluated: true,
    });

    const res = await get("?mock=0");
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(res.headers.get("x-ascent-ratelimit-scope")).toBe("global");
    expect(body).toMatchObject({ code: "rate_limited", scope: "global" });
    // Anyone can call this endpoint anonymously; echoing the fleet budget or its headroom would
    // turn a public CI gate into a capacity meter for whoever is exhausting it.
    expect(body.limit).toBeUndefined();
    expect(body.windowSec).toBeUndefined();
    expect(res.headers.get("x-ascent-ratelimit-limit")).toBeNull();
    expect(JSON.stringify(body)).not.toMatch(/\b\d{2,}\s*(requests|per)\b/);
  });

  it("?mock=0 — an UNEVALUATED refusal reports the outage instead of blaming the caller", async () => {
    mockRateLimitShared.mockResolvedValue({
      ok: false,
      retryAfterSec: 5,
      scope: "unavailable",
      limiter: "scan",
      evaluated: false,
    });

    const res = await get("?mock=0");

    expect(res.status).toBe(429);
    expect(res.headers.get("x-ascent-ratelimit-scope")).toBe("unavailable");
    expect(res.headers.get("retry-after")).toBe("5");
    expect(await res.json()).toMatchObject({ code: "rate_limit_unavailable", scope: "unavailable", evaluated: false });
  });

  it("the default (mock) INGEST path also names its scope when the in-memory limiter refuses", async () => {
    mockCacheGet.mockReturnValue(undefined); // both cache tiers miss → the ingest gate is charged
    mockPersisted.mockResolvedValue(null);
    mockRateLimit.mockReturnValue({
      ok: false,
      retryAfterSec: 15,
      scope: "ip",
      limiter: "gate",
      limit: 30,
      windowSec: 60,
      evaluated: true,
    });

    const res = await get();

    expect(res.status).toBe(429);
    expect(res.headers.get("x-ascent-ratelimit-scope")).toBe("ip");
    expect(await res.json()).toMatchObject({ scope: "ip", limiter: "gate", limit: 30, windowSec: 60 });
    expect(mockScan).not.toHaveBeenCalled(); // refused before the GitHub ingest it protects
  });
});
