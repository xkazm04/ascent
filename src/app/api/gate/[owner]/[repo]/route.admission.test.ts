// moonshot #8 / #16 — the admission layer of the gate's ordered policy fold, at the ROUTE.
//
// The endpoint is UNAUTHENTICATED, so the whole safety argument rests on one property: the overlay
// is folded through `tightenGatePolicy` exactly like a query param, and can therefore only ever
// RAISE a bar. That is what makes it safe to read org-scoped state on an anonymous request. The
// tighten-only regression guard below is the assertion that keeps it true.
//
// A sibling file rather than more of route.test.ts: that file is the 200/422 CI contract and is
// already long, and these cases need their own default for the admission seam.
//
// `tightenGatePolicy` / `defaultGatePolicy` / `explicitPolicyFromParams` are the REAL
// implementations — mocking the merge would make every assertion here vacuous.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScanReport } from "@/lib/types";

vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
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
vi.mock("@/lib/scan-cache", () => ({
  resolveHeadWithHint: vi.fn(async () => "sha123"),
  lookupPersistedScanByCommit: vi.fn(async () => null),
}));
vi.mock("@/lib/cache", () => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  makeCacheKey: (o: string, r: string, llm: boolean, sha: string | null) => `${o}/${r}@${sha}::${llm ? "llm" : "mock"}`,
  normalizeRepoName: (s: string) => s.toLowerCase(),
}));
vi.mock("@/lib/scoring/gate", async (orig) => ({
  ...(await orig<typeof import("@/lib/scoring/gate")>()),
  evaluateGate: vi.fn(() => ({ pass: true, policy: {}, failures: [] })),
}));
vi.mock("@/lib/db/org-gate", () => ({ getOrgGatePolicy: vi.fn(async () => null) }));
// TENANCY: which org's state governs this repo. Defaults to the owner login (the fast path), so every
// pre-existing case in this file is unchanged; the slug≠owner case overrides it.
vi.mock("@/lib/db/org-tenancy", () => ({ orgSlugForRepo: vi.fn(async (owner: string) => owner) }));
vi.mock("@/lib/scoring/gate-admission", () => ({
  resolveAdmissionLayer: vi.fn(async () => ({ overlay: {}, admission: null })),
  loadCheckStates: vi.fn(async () => null),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimitRequest: vi.fn(() => ({ ok: true, retryAfterSec: 0 })),
  rateLimitRequestShared: vi.fn(async () => ({ ok: true, retryAfterSec: 0 })),
  tooManyRequests: vi.fn(),
  SCAN_RATE_LIMIT: {},
  GATE_RATE_LIMIT: {},
}));

import { GET } from "./route";
import { cacheGet } from "@/lib/cache";
import { evaluateGate } from "@/lib/scoring/gate";
import { getOrgGatePolicy } from "@/lib/db/org-gate";
import { loadCheckStates, resolveAdmissionLayer } from "@/lib/scoring/gate-admission";
import { orgSlugForRepo } from "@/lib/db/org-tenancy";

const mockCacheGet = vi.mocked(cacheGet);
const mockEvaluate = vi.mocked(evaluateGate);
const mockOrgPolicy = vi.mocked(getOrgGatePolicy);
const mockAdmission = vi.mocked(resolveAdmissionLayer);
const mockCheckStates = vi.mocked(loadCheckStates);
const mockOrgSlug = vi.mocked(orgSlugForRepo);

const report = () =>
  ({
    repo: { fullName: "acme/widget", isPrivate: false },
    overallScore: 72,
    level: { id: "L3" },
    posture: { id: "governed" },
    archetype: "org",
    engine: { provider: "claude-cli", model: "claude-opus" },
    confidence: 0.92,
    warnings: [],
  }) as unknown as ScanReport;

async function get(query = "", owner = "acme", repo = "widget") {
  return GET(new Request(`http://localhost/api/gate/${owner}/${repo}${query}`), {
    params: Promise.resolve({ owner, repo }),
  });
}

/** The policy the route actually handed the evaluator. */
const policyUsed = () => mockEvaluate.mock.calls[0]![1];
const inputsUsed = () => mockEvaluate.mock.calls[0]![2];

beforeEach(() => {
  vi.clearAllMocks();
  mockCacheGet.mockReturnValue(report());
  mockOrgPolicy.mockResolvedValue(null);
  mockAdmission.mockResolvedValue({ overlay: {}, admission: null });
  mockCheckStates.mockResolvedValue(null);
  mockOrgSlug.mockImplementation(async (owner: string) => owner);
  mockEvaluate.mockReturnValue({ pass: true, policy: { minLevel: "L3" }, failures: [], skipped: [], caveats: [] });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("no admission row — the byte-identical no-op", () => {
  it("produces a body with NO `admission` key at all", async () => {
    const body = await (await get()).json();
    // Omitted, not nulled: a repo without a decision must be indistinguishable from one gated before
    // this layer existed. `null` would be a new field every consumer's schema has to learn.
    expect("admission" in body).toBe(false);
    expect(body.pass).toBe(true);
  });

  it("does not read the conformance ledger when no policy names a check", async () => {
    await get();
    expect(mockCheckStates).not.toHaveBeenCalled();
    expect(inputsUsed()).toMatchObject({ checkStates: null });
  });
});

describe("the admission overlay TIGHTENS and can never weaken", () => {
  // FAIL-BEFORE: pre-change the route folded only (org ⊕ params), so a T0 admission row beside a
  // lenient org policy returned the LENIENT bar and the strictest decision in the product had no
  // effect on the verdict CI reads.
  it("a T0 row raises a lenient org bar", async () => {
    mockOrgPolicy.mockResolvedValue({ minLevel: "L2", minAiGovernedRate: 50 });
    mockAdmission.mockResolvedValue({
      overlay: { requireProtectedBranch: true, minAiGovernedRate: 100, forbidPostures: ["ungoverned"] },
      admission: { mode: "assisted-only", tier: "T0", source: "granted" },
    });

    await get();

    expect(policyUsed()).toEqual({
      minLevel: "L2",
      minAiGovernedRate: 100,
      requireProtectedBranch: true,
      forbidPostures: ["ungoverned"],
    });
  });

  // THE REGRESSION GUARD. An overlay carrying a LOOSER value than the org's must change nothing.
  // If this ever goes red, the unauthenticated endpoint has become a way to lower a configured bar.
  it("an overlay that would LOOSEN the org bar changes nothing", async () => {
    const orgBar = { minLevel: "L4" as const, minDimension: 60, minAiGovernedRate: 100, requireProtectedBranch: true };
    mockOrgPolicy.mockResolvedValue(orgBar);
    mockAdmission.mockResolvedValue({
      // A deliberately malformed/looser fragment — the kind a future bug or a corrupt row could emit.
      overlay: { minLevel: "L1", minDimension: 5, minAiGovernedRate: 10 },
      admission: { mode: "agents-allowed", tier: "T3", source: "granted" },
    });

    await get();

    expect(policyUsed()).toEqual(orgBar);
  });

  it("a T3 row adds no floor to the org's bar", async () => {
    const orgBar = { minLevel: "L4" as const, minDimension: 60 };
    mockOrgPolicy.mockResolvedValue(orgBar);
    mockAdmission.mockResolvedValue({ overlay: {}, admission: { mode: "agents-allowed", tier: "T3", source: "granted" } });

    await get();

    expect(policyUsed()).toEqual(orgBar);
  });

  it("applies on the NO-ORG-POLICY path too — an overlay must survive both precedence paths", async () => {
    mockOrgPolicy.mockResolvedValue(null);
    mockAdmission.mockResolvedValue({
      overlay: { minAiGovernedRate: 100, requireProtectedBranch: true },
      admission: { mode: "assisted-only", tier: "T1", source: "derived" },
    });

    await get();

    const pol = policyUsed()!;
    expect(pol.minAiGovernedRate).toBe(100);
    expect(pol.requireProtectedBranch).toBe(true);
    // …and the archetype default the params path installs is still there.
    expect(pol.minLevel).toBe("L3");
  });

  it("a query param can still tighten ON TOP of the admission layer", async () => {
    mockOrgPolicy.mockResolvedValue({ minOverall: 50 });
    mockAdmission.mockResolvedValue({ overlay: { minOverall: 70 }, admission: { mode: "assisted-only", tier: "T1", source: "derived" } });

    await get("?min_overall=90");

    expect(policyUsed()!.minOverall).toBe(90);
  });
});

describe("the verdict says WHY it was held to this bar", () => {
  it("carries the {mode, tier, source} triple in the body", async () => {
    mockAdmission.mockResolvedValue({ overlay: {}, admission: { mode: "blocked", tier: "T0", source: "granted" } });

    const body = await (await get()).json();

    expect(body.admission).toEqual({ mode: "blocked", tier: "T0", source: "granted" });
  });

  it('reports an unassessed tier as null with source "none", never as T0', async () => {
    mockAdmission.mockResolvedValue({ overlay: {}, admission: { mode: "assisted-only", tier: null, source: "none" } });

    const body = await (await get()).json();

    expect(body.admission).toEqual({ mode: "assisted-only", tier: null, source: "none" });
  });
});

describe("a read failure produces NO verdict", () => {
  it("503s rather than gating on a bar it could not read", async () => {
    // The same fail-closed rule the org-policy read keeps: getRepoAdmission returns null without
    // throwing for every legitimate absence, so a throw means only that the bar is unknown.
    mockAdmission.mockRejectedValue(new Error("db down"));

    const res = await get();

    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("admission decision could not be read");
    expect(mockEvaluate).not.toHaveBeenCalled();
  });
});

describe("requireChecks reads the ledger only when a check is named", () => {
  it("loads the check states and threads them into the evaluator", async () => {
    mockOrgPolicy.mockResolvedValue({ requireChecks: ["control.prepush.lint"] });
    mockCheckStates.mockResolvedValue({ "control.prepush.lint": "fail" });

    await get();

    expect(mockCheckStates).toHaveBeenCalledWith("acme", "acme/widget");
    expect(inputsUsed()).toMatchObject({ checkStates: { "control.prepush.lint": "fail" } });
  });

  it("a null ledger reaches the evaluator as null — a skip, never a manufactured failure", async () => {
    mockOrgPolicy.mockResolvedValue({ requireChecks: ["control.prepush.lint"] });
    mockCheckStates.mockResolvedValue(null);

    await get();

    expect(inputsUsed()).toMatchObject({ checkStates: null });
  });
});

// ---------------------------------------------------------------------------
// ORG STATE BY TENANCY (Direction 7)
//
// Both org-scoped reads keyed on the GITHUB OWNER LOGIN. For an org whose slug is not its owner
// namespace — an org named for the team, watching repos under a personal account, which is the case
// `repoUnderOrg` was already fixed for — the persisted policy and the admission overlay BOTH resolved
// to null, silently, and null reads as "no bar configured". The gate then went green on the archetype
// default while the org's own dashboard displayed the bar it believed was being enforced.
// ---------------------------------------------------------------------------
describe("the governing org is the one that TRACKS the repo, not the owner login", () => {
  it("reads the persisted policy AND the admission overlay under the tracking org's slug", async () => {
    // org `kiro` tracks `xkazm04/kp`; the owner namespace is not an org at all.
    mockOrgSlug.mockResolvedValue("kiro");
    mockOrgPolicy.mockResolvedValue({ minLevel: "L4" });
    mockAdmission.mockResolvedValue({
      overlay: { requireProtectedBranch: true },
      admission: { mode: "assisted-only", tier: "T1", source: "derived" },
    });

    const res = await get("", "xkazm04", "kp");
    const body = await res.json();

    expect(mockOrgSlug).toHaveBeenCalledWith("xkazm04", "xkazm04/kp");
    // FAIL-BEFORE: both of these were called with "xkazm04" and found nothing.
    expect(mockOrgPolicy).toHaveBeenCalledWith("kiro");
    expect(mockAdmission).toHaveBeenCalledWith("kiro", "xkazm04/kp");
    // And the found bar is the one enforced: the org's level, tightened by the overlay's rule.
    expect(mockEvaluate.mock.calls[0]![1]).toMatchObject({ minLevel: "L4", requireProtectedBranch: true });
    expect(body.admission).toMatchObject({ tier: "T1" });
  });

  it("503s when the tenant could not be resolved — not determining the org IS not reading the bar", async () => {
    mockOrgSlug.mockRejectedValue(new Error("db down"));

    const res = await get("", "xkazm04", "kp");

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("could not be read") });
  });
});
