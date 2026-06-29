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
vi.mock("@/lib/scan-cache", () => ({ resolveHeadWithHint: vi.fn(async () => "sha123") }));
vi.mock("@/lib/cache", () => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  makeCacheKey: (owner: string, repo: string, llm: boolean, sha: string | null) =>
    `${owner}/${repo}@${sha}::${llm ? "llm" : "mock"}`,
  normalizeRepoName: (s: string) => s.toLowerCase(),
}));
// Gate evaluation is mocked so we drive pass/fail deterministically and can assert that the route's
// status maps off `gate.pass` exactly. policyFromParams is mocked to a spy so we can assert query
// params reach it.
vi.mock("@/lib/scoring/gate", () => ({
  evaluateGate: vi.fn(),
  policyFromParams: vi.fn(() => ({ minLevel: "L3", minDimension: 40 })),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimitRequest: vi.fn(() => ({ ok: true, retryAfterSec: 0 })),
  tooManyRequests: vi.fn((sec: number) =>
    new Response(JSON.stringify({ error: "Rate limit exceeded." }), {
      status: 429,
      headers: { "retry-after": String(sec) },
    }),
  ),
  SCAN_RATE_LIMIT: {},
  GATE_RATE_LIMIT: {},
}));

import { GET } from "./route";
import { scanRepository } from "@/lib/scan";
import { cacheGet, cacheSet } from "@/lib/cache";
import { evaluateGate, policyFromParams } from "@/lib/scoring/gate";
import { rateLimitRequest, tooManyRequests } from "@/lib/rate-limit";

const mockScan = vi.mocked(scanRepository);
const mockCacheGet = vi.mocked(cacheGet);
const mockCacheSet = vi.mocked(cacheSet);
const mockEvaluateGate = vi.mocked(evaluateGate);
const mockPolicyFromParams = vi.mocked(policyFromParams);
const mockRateLimit = vi.mocked(rateLimitRequest);
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
    mockPolicyFromParams.mockReturnValue({ minLevel: "L3", minDimension: 40 } as never);
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
    expect(mockTooManyRequests).not.toHaveBeenCalled();
  });

  it("?mock=0 (real LLM) invokes rateLimitRequest and returns 429 (tooManyRequests) when rl.ok is false", async () => {
    mockRateLimit.mockReturnValue({ ok: false, retryAfterSec: 30 });

    const res = await get("?mock=0");

    expect(mockRateLimit).toHaveBeenCalledTimes(1);
    expect(mockTooManyRequests).toHaveBeenCalledWith(30);
    expect(res.status).toBe(429);
    // Short-circuited BEFORE scanning/evaluating — no LLM budget spent on a throttled request.
    expect(mockScan).not.toHaveBeenCalled();
    expect(mockEvaluateGate).not.toHaveBeenCalled();
  });

  it("?mock=false is also treated as the real-LLM path (rate-limited)", async () => {
    mockEvaluateGate.mockReturnValue({ pass: true, policy: {}, failures: [] } as never);
    await get("?mock=false");
    expect(mockRateLimit).toHaveBeenCalledTimes(1);
  });

  it("?mock=0 with rl.ok=true proceeds to evaluate and returns 200 on a pass", async () => {
    mockRateLimit.mockReturnValue({ ok: true, retryAfterSec: 0 });
    mockEvaluateGate.mockReturnValue({ pass: true, policy: {}, failures: [] } as never);

    const res = await get("?mock=0");
    expect(mockRateLimit).toHaveBeenCalledTimes(1);
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
    expect(mockScan).toHaveBeenCalledWith("acme/widget", { mock: true, ref: "deadbeef" });
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

  it("non-ref path scans and populates the cache on a miss", async () => {
    mockCacheGet.mockReturnValue(undefined);
    mockScan.mockResolvedValue(report());
    mockEvaluateGate.mockReturnValue({ pass: true, policy: {}, failures: [] } as never);

    const res = await get();
    expect(res.status).toBe(200);
    expect(mockScan).toHaveBeenCalledWith("acme/widget", { mock: true });
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
});
