// Regression tests for SHA-drift prevention (scan-and-decide idea 744fc886): when the routes
// pass the head sha already resolved for the cache key, the scan must pin ingestion to it and
// stamp it as the report's commit identity — so the cache key and the scored commit agree even
// if a push lands between the head lookup and the tree read. An explicit PR `ref` still wins.
//
// A mock RepoSource keeps this fully offline; mock:true + no token avoids every network call.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { scanRepository, resolveScanAuth, isHardLlmError, shouldRetrySameProvider } from "./scan";
import type { FetchOptions, ParsedRepo, RepoSource } from "@/lib/github/source";
import type { LlmAssessment, RepoSnapshot, TokenUsage } from "@/lib/types";
import type { AssessOptions, LLMProvider, LlmScoreInput } from "@/lib/llm/provider";
import type { LlmCallTrack } from "@/lib/llm/tracklight";

// ---------------------------------------------------------------------------
// Auth-dependency harness for the resolveScanAuth cross-tenant gate suite.
// resolveScanAuth authorizes BEFORE minting an installation token, via the single
// shared gate canMintInstallationToken(owner) (authz.ts). A caller-supplied
// installationId is only ever a hint for THAT owner, and when the mint is denied
// for an INSTALLED org the ambient operator PAT is refused too (noAmbientToken) —
// otherwise the fallback would leak the very private repo the gate just denied.
//
// This suite previously drove the branch via (isAuthConfigured, sessionOwnsOrg)
// with authConfigured = true. Production runs the Supabase wall with the legacy
// OAuth env UNSET, so isAuthConfigured() is false there and the old predicate
// `!isAuthConfigured() || sessionOwnsOrg(owner)` short-circuited to ALLOW every
// caller. The suite was green precisely because it never exercised the production
// shape. canMintInstallationToken is now the seam, and its own tests (authz.test.ts)
// pin the prod configuration directly.
const authControl = {
  appConfigured: true,
  authConfigured: true,
  canMintInstallationToken: vi.fn<(owner: string) => Promise<boolean>>(),
  getInstallationIdForOwner: vi.fn<(owner: string) => Promise<string | null>>(),
  getInstallationToken: vi.fn<(id: string) => Promise<string>>(),
};

vi.mock("@/lib/github/app", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/github/app")>();
  return {
    ...actual,
    isAppConfigured: () => authControl.appConfigured,
    getInstallationToken: (id: string) => authControl.getInstallationToken(id),
  };
});
vi.mock("@/lib/auth", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/auth")>();
  return { ...actual, isAuthConfigured: () => authControl.authConfigured };
});
vi.mock("@/lib/authz", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/authz")>();
  return {
    ...actual,
    canMintInstallationToken: (owner: string) => authControl.canMintInstallationToken(owner),
  };
});
// Standing-decision read seam (individual tier): scanRepository resolves the slug it reads decisions
// from (decisionOrgSlug ?? orgSlug); this spy pins WHICH slug that is per funnel.
const dbControl = {
  decisionsForRepo: vi.fn<(slug: string, fullName: string) => Promise<never[]>>(),
};

vi.mock("@/lib/db", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/db")>();
  return {
    ...actual,
    getInstallationIdForOwner: (owner: string) => authControl.getInstallationIdForOwner(owner),
    decisionsForRepo: (slug: string, fullName: string) => dbControl.decisionsForRepo(slug, fullName),
  };
});

// ---------------------------------------------------------------------------
// LLM-provider injection harness (for the usage-metering + degradation-honesty
// suites appended below). scan.ts resolves its primary provider via
// getProvider() and its failover via providerByName(), both from "@/lib/llm".
// Mock that module so a test can drive a usable / unusable / throwing attempt,
// while keeping the REAL MockProvider (scan.ts degrades to it directly).
// ---------------------------------------------------------------------------
const llmControl: {
  primary: LLMProvider | null;
  fallback: LLMProvider | null;
} = { primary: null, fallback: null };

vi.mock("@/lib/llm", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/llm")>();
  return {
    ...actual,
    // forceMock (opts.mock:true) must still yield the real deterministic mock so the
    // pre-existing SHA-threading suite below is unaffected; otherwise hand back the
    // test-installed primary provider.
    getProvider: (opts: { forceMock?: boolean } = {}) =>
      opts.forceMock ? new actual.MockProvider() : (llmControl.primary ?? new actual.MockProvider()),
    // Org-aware selection (BYOM): scanRepository routes provider selection through this now. For these
    // (non-BYOM) tests it must honor the test-installed primary, exactly like getProvider above, and
    // report byom:false so the existing failover/fail-to-mock behavior is unchanged.
    getProviderForOrg: async (_orgSlug: string | undefined | null, opts: { forceMock?: boolean } = {}) => ({
      provider: opts.forceMock ? new actual.MockProvider() : (llmControl.primary ?? new actual.MockProvider()),
      byom: false,
    }),
    // Failover lookup — return the test-installed fallback (or null = "no real fallback",
    // which makes scan.ts degrade straight to its own MockProvider).
    providerByName: () => llmControl.fallback,
  };
});

// LightTrack capture harness: the tracker is fire-and-forget and env-gated, so the ONLY way to pin
// what the scan reports about itself is to intercept trackLlmCall. Used by the degradation-
// observability suite below.
const trackControl: { calls: LlmCallTrack[] } = { calls: [] };
vi.mock("@/lib/llm/tracklight", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/llm/tracklight")>();
  return {
    ...actual,
    trackLlmCall: (ev: LlmCallTrack) => {
      trackControl.calls.push(ev);
    },
  };
});

const NOW = "2026-06-02T00:00:00Z";

/** A RepoSource that returns a fixed snapshot (its meta.headSha is the TREE sha) and records the
 *  FetchOptions it was called with, so a test can assert which ref ingestion was pinned to. */
function mockSource(treeSha: string) {
  let captured: FetchOptions | undefined;
  const source: RepoSource = {
    async fetchSnapshot(_repo: ParsedRepo, opts: FetchOptions = {}): Promise<RepoSnapshot> {
      captured = opts;
      return {
        meta: { owner: "o", name: "r", url: "", stars: 0, forks: 0, defaultBranch: "main", headSha: treeSha },
        tree: [{ path: "README.md", type: "blob" }],
        files: [{ path: "README.md", content: "# r", bytes: 3 }],
        commits: [{ message: "feat: x" }],
        truncated: false,
        coverage: 1,
      };
    },
  };
  return { source, ref: () => captured?.ref };
}

describe("scanRepository — head sha threading (#6)", () => {
  // Ensure no ambient GITHUB_TOKEN triggers PR/governance network calls.
  beforeEach(() => vi.stubEnv("GITHUB_TOKEN", ""));
  afterEach(() => vi.unstubAllEnvs());

  it("stamps the report with the resolved commit sha (not the tree sha) and pins ingestion to it", async () => {
    const { source, ref } = mockSource("treesha-aaa");
    const report = await scanRepository("o/r", { source, mock: true, now: NOW, headSha: "commitsha-zzz" });
    expect(report.repo.headSha).toBe("commitsha-zzz");
    expect(ref()).toBe("commitsha-zzz");
  });

  it("leaves the snapshot's own headSha and an unpinned ref when none is threaded", async () => {
    const { source, ref } = mockSource("treesha-aaa");
    const report = await scanRepository("o/r", { source, mock: true, now: NOW });
    expect(report.repo.headSha).toBe("treesha-aaa");
    expect(ref()).toBeUndefined();
  });

  it("lets an explicit PR ref win over headSha (no stamping)", async () => {
    const { source, ref } = mockSource("treesha-aaa");
    const report = await scanRepository("o/r", {
      source,
      mock: true,
      now: NOW,
      ref: "pr-branch",
      headSha: "commitsha-zzz",
    });
    expect(ref()).toBe("pr-branch");
    expect(report.repo.headSha).toBe("treesha-aaa");
  });
});

// ---------------------------------------------------------------------------
// Usage metering + degradation honesty (scan.ts:204-219 attemptAssess /
// capturedUsage; 273-296 degrade-to-mock). These are the money + trust
// invariants: a FAILED attempt's tokens must never reach report.usage (the
// metering basis), an UNUSABLE result must degrade to a *labeled* mock (never
// served under a real provider's name), and a genuinely usable result is served
// as-is with its real provider + usage.
// ---------------------------------------------------------------------------

/** Build a full 9-dimension (D1..D9) assessment so isAssessmentUsable passes
 *  (needs >= ceil(9*0.5)=5 scored dims). */
function usableAssessment(): LlmAssessment {
  const ids = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9"] as const;
  return {
    dimensions: ids.map((id) => ({ id, score: 70, summary: `${id} ok`, strengths: [], gaps: [] })),
    headline: "AI-written headline",
    strengths: [],
    risks: [],
    roadmap: [],
    discrepancies: [],
  };
}

/** An assessment that PARSES but scores nothing — isAssessmentUsable === false. */
function unusableAssessment(): LlmAssessment {
  return { dimensions: [], headline: "", strengths: [], risks: [], roadmap: [], discrepancies: [] };
}

type Outcome =
  | { kind: "usable"; usage?: TokenUsage }
  | { kind: "unusable"; usage?: TokenUsage }
  | { kind: "throw"; usage?: TokenUsage; error?: Error };

/** A fake real (non-mock) provider whose assess() fires onUsage (as real providers do,
 *  BEFORE the usability check) and then resolves/rejects per `outcome`. Each call walks
 *  one step of `outcomes`, defaulting to the last entry for retries. */
function fakeProvider(name: "gemini" | "openai", outcomes: Outcome[]): LLMProvider & { calls: number } {
  let i = 0;
  return {
    name,
    model: `${name}-test-model`,
    calls: 0,
    async assess(_input: LlmScoreInput, opts: AssessOptions = {}): Promise<LlmAssessment> {
      this.calls++;
      const o = outcomes[Math.min(i, outcomes.length - 1)]!;
      i++;
      // Providers report usage BEFORE the parse/usability gate — the exact hazard under test.
      if (o.usage) opts.onUsage?.(o.usage);
      if (o.kind === "throw") throw o.error ?? new Error(`${name} attempt failed`);
      return o.kind === "usable" ? usableAssessment() : unusableAssessment();
    },
  };
}

describe("scanRepository — LLM usage metering + degradation honesty (#2/#3)", () => {
  beforeEach(() => {
    vi.stubEnv("GITHUB_TOKEN", "");
    vi.stubEnv("LLM_FALLBACK_PROVIDER", "");
    llmControl.primary = null;
    llmControl.fallback = null;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    llmControl.primary = null;
    llmControl.fallback = null;
  });

  it("serves a genuinely usable LLM result as-is with its real provider + real usage", async () => {
    const { source } = mockSource("treesha-aaa");
    llmControl.primary = fakeProvider("gemini", [{ kind: "usable", usage: { inputTokens: 1234, outputTokens: 567 } }]);
    const report = await scanRepository("o/r", { source, now: NOW });

    expect(report.engine.provider).toBe("gemini");
    // Real winning attempt's tokens are the metering basis.
    expect(report.usage?.inputTokens).toBe(1234);
    expect(report.usage?.outputTokens).toBe(567);
    expect(report.usage?.latencyMs).toBeTypeOf("number");
    // A genuinely AI-scored report must NOT carry the "AI unavailable" caveat.
    expect(report.warnings ?? []).not.toContain(
      "AI analysis was unavailable, so scores reflect detected signals only (no qualitative nuance).",
    );
  });

  it("does NOT bill a FAILED (throwing) attempt — its tokens stay off report.usage when the scan degrades to mock", async () => {
    const { source } = mockSource("treesha-aaa");
    // Primary reports usage, THEN throws on every attempt (primary + its retry). No fallback configured.
    llmControl.primary = fakeProvider("gemini", [
      { kind: "throw", usage: { inputTokens: 9999, outputTokens: 8888 } },
    ]);
    const report = await scanRepository("o/r", { source, now: NOW });

    // Degraded to the deterministic mock, and SAID SO.
    expect(report.engine.provider).toBe("mock");
    // METERING INVARIANT: the failed attempt's tokens are excluded from the basis.
    expect(report.usage?.inputTokens).toBeUndefined();
    expect(report.usage?.outputTokens).toBeUndefined();
    expect(report.usage?.latencyMs).toBeTypeOf("number"); // latency is always stamped
  });

  it("commits usage from the WINNING failover attempt only — not the failed primary's tokens", async () => {
    const { source } = mockSource("treesha-aaa");
    // Primary reports big usage then throws (both its attempts); fallback reports small usage and succeeds.
    llmControl.primary = fakeProvider("gemini", [
      { kind: "throw", usage: { inputTokens: 9999, outputTokens: 8888 } },
    ]);
    llmControl.fallback = fakeProvider("openai", [{ kind: "usable", usage: { inputTokens: 10, outputTokens: 5 } }]);
    vi.stubEnv("LLM_FALLBACK_PROVIDER", "openai");

    const report = await scanRepository("o/r", { source, now: NOW });

    // The provider that actually produced the accepted assessment becomes the engine.
    expect(report.engine.provider).toBe("openai");
    // METERING INVARIANT: usage == winner's tokens only; the failed primary's are excluded.
    expect(report.usage?.inputTokens).toBe(10);
    expect(report.usage?.outputTokens).toBe(5);
  });

  it("does NOT serve an UNUSABLE (parseable-but-empty) result as a real provider score — degrades to a LABELED mock", async () => {
    const { source } = mockSource("treesha-aaa");
    // Primary parses but scores 0 dimensions on every attempt; no fallback.
    llmControl.primary = fakeProvider("gemini", [
      { kind: "unusable", usage: { inputTokens: 4321, outputTokens: 1234 } },
    ]);
    const report = await scanRepository("o/r", { source, now: NOW });

    // HONESTY INVARIANT: an unusable result is NOT branded as a real provider's score.
    expect(report.engine.provider).toBe("mock");
    // ...and it is LABELED: the llmFailed warning must be present.
    expect(report.warnings ?? []).toContain(
      "AI analysis was unavailable, so scores reflect detected signals only (no qualitative nuance).",
    );
    // ...and the unusable attempt's tokens are NOT metered.
    expect(report.usage?.inputTokens).toBeUndefined();
    expect(report.usage?.outputTokens).toBeUndefined();
  });

  it("an unusable primary then a usable failover is served as the failover (no llmFailed warning)", async () => {
    const { source } = mockSource("treesha-aaa");
    llmControl.primary = fakeProvider("gemini", [
      { kind: "unusable", usage: { inputTokens: 777, outputTokens: 333 } },
    ]);
    llmControl.fallback = fakeProvider("openai", [{ kind: "usable", usage: { inputTokens: 20, outputTokens: 8 } }]);
    vi.stubEnv("LLM_FALLBACK_PROVIDER", "openai");

    const report = await scanRepository("o/r", { source, now: NOW });

    expect(report.engine.provider).toBe("openai");
    expect(report.usage?.inputTokens).toBe(20);
    expect(report.usage?.outputTokens).toBe(8);
    // Recovered by the failover — NOT a degraded scan, so no "AI unavailable" caveat.
    expect(report.warnings ?? []).not.toContain(
      "AI analysis was unavailable, so scores reflect detected signals only (no qualitative nuance).",
    );
  });

  it("a keyless/intentional mock (opts.mock) carries NO tokens and NO spurious llmFailed warning", async () => {
    const { source } = mockSource("treesha-aaa");
    // mock:true → getProvider returns the real MockProvider; intendedProvider === "mock".
    const report = await scanRepository("o/r", { source, mock: true, now: NOW });

    expect(report.engine.provider).toBe("mock");
    expect(report.usage?.inputTokens).toBeUndefined();
    expect(report.usage?.outputTokens).toBeUndefined();
    // An intentional mock must NOT claim "AI was unavailable" — that warning is only for a real failure.
    expect(report.warnings ?? []).not.toContain(
      "AI analysis was unavailable, so scores reflect detected signals only (no qualitative nuance).",
    );
    // ...nor the keyless caveat: an EXPLICIT demo (opts.mock) is framed as a demo by the UI, not flagged.
    expect(report.warnings ?? []).not.toContain(
      "No AI model is configured for this scan, so scores reflect detected signals only (the deterministic rubric, no AI nuance).",
    );
  });

  it("a keyless/unconfigured deploy (mock from the start, NOT opts.mock) gets the loud 'no AI configured' caveat", async () => {
    const { source } = mockSource("treesha-aaa");
    // primary stays null (beforeEach) and no opts.mock → getProvider returns the MockProvider:
    // intendedProvider === "mock" and llmFailed stays false. This is the keyless-default path (MEI-B1).
    const report = await scanRepository("o/r", { source, now: NOW });

    expect(report.engine.provider).toBe("mock");
    // Nothing FAILED, so the failure-path caveat must not fire...
    expect(report.warnings ?? []).not.toContain(
      "AI analysis was unavailable, so scores reflect detected signals only (no qualitative nuance).",
    );
    // ...but the floor must be disclosed loudly, not just via a quiet engine chip, so a public-badge or
    // audit reader knows the AI layer never ran.
    expect(report.warnings ?? []).toContain(
      "No AI model is configured for this scan, so scores reflect detected signals only (the deterministic rubric, no AI nuance).",
    );
  });
});

// ---------------------------------------------------------------------------
// Budget-aware LLM retry (DIRECTION 2). Under a tight (~90s hosted) budget, a HARD provider failure
// (auth / 4xx / model-not-found) must NOT burn a same-provider retry that cannot succeed — it should
// skip straight to the failover, preserving the budget for a provider that might work. Transient
// failures still retry. The matrix is pinned on the pure decision functions (isHardLlmError /
// shouldRetrySameProvider); the two timing-free wirings are pinned end-to-end through scanRepository.
// ---------------------------------------------------------------------------
// The `degraded` flag is what makes the degradation RATE observable in LightTrack. It was declared on
// LlmCallTrack and read by buildEventBody, but neither scan.ts call site ever passed it — so the tag
// could never fire. These tests pin that it now flows, and that it is HONEST: a failed attempt that a
// retry/failover recovers did not degrade the scan; only the last failing attempt did.
describe("scanRepository — degradation observability (tracklight `degraded`)", () => {
  beforeEach(() => {
    vi.stubEnv("GITHUB_TOKEN", "");
    vi.stubEnv("LLM_FALLBACK_PROVIDER", "");
    llmControl.primary = null;
    llmControl.fallback = null;
    trackControl.calls = [];
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    llmControl.primary = null;
    llmControl.fallback = null;
    trackControl.calls = [];
  });

  it("marks a usable call NOT degraded", async () => {
    const { source } = mockSource("treesha-aaa");
    llmControl.primary = fakeProvider("gemini", [{ kind: "usable", usage: { inputTokens: 10, outputTokens: 5 } }]);
    await scanRepository("o/r", { source, now: NOW });

    expect(trackControl.calls).toHaveLength(1);
    expect(trackControl.calls[0]).toMatchObject({ provider: "gemini", status: "success", degraded: false });
  });

  it("marks ONLY the last failing attempt degraded when the scan falls to the floor", async () => {
    const { source } = mockSource("treesha-aaa");
    // Transient failure on every attempt, no fallback ⇒ plan is [primary, retry] and the RETRY is the
    // call that actually drops the scan to the deterministic mock.
    llmControl.primary = fakeProvider("gemini", [{ kind: "throw", usage: { inputTokens: 99 } }]);
    const report = await scanRepository("o/r", { source, now: NOW });

    expect(report.engine.provider).toBe("mock");
    expect(trackControl.calls.map((c) => c.status)).toEqual(["error", "error"]);
    expect(trackControl.calls.map((c) => c.degraded)).toEqual([false, true]);
    // The deterministic mock itself is never tracked (no real provider traffic/cost).
    expect(trackControl.calls.every((c) => c.provider !== "mock")).toBe(true);
  });

  it("never marks a failure degraded when a failover still recovers the scan", async () => {
    const { source } = mockSource("treesha-aaa");
    llmControl.primary = fakeProvider("gemini", [{ kind: "throw" }]);
    llmControl.fallback = fakeProvider("openai", [{ kind: "usable", usage: { inputTokens: 10, outputTokens: 5 } }]);
    vi.stubEnv("LLM_FALLBACK_PROVIDER", "openai");
    const report = await scanRepository("o/r", { source, now: NOW });

    expect(report.engine.provider).toBe("openai");
    expect(trackControl.calls.some((c) => c.degraded === true)).toBe(false);
    expect(trackControl.calls.at(-1)).toMatchObject({ provider: "openai", status: "success", degraded: false });
  });

  it("marks an unusable-but-answered final attempt degraded (it produced no usable assessment)", async () => {
    const { source } = mockSource("treesha-aaa");
    llmControl.primary = fakeProvider("gemini", [{ kind: "unusable", usage: { inputTokens: 42 } }]);
    const report = await scanRepository("o/r", { source, now: NOW });

    expect(report.engine.provider).toBe("mock");
    expect(trackControl.calls.at(-1)).toMatchObject({ status: "error", degraded: true });
  });
});

describe("isHardLlmError — provider failure classification (conservative: unknown ⇒ transient)", () => {
  const awsErr = (name: string) => Object.assign(new Error(name), { name });
  const metaErr = (httpStatusCode: number) => Object.assign(new Error("aws"), { $metadata: { httpStatusCode } });

  it("classifies AWS SDK (Bedrock) auth/4xx/model-not-found exception NAMES as HARD", () => {
    for (const n of ["AccessDeniedException", "ValidationException", "ResourceNotFoundException", "UnrecognizedClientException"]) {
      expect(isHardLlmError(awsErr(n))).toBe(true);
    }
  });

  it("treats AWS throttling / 5xx / model-timeout exception names as TRANSIENT (still retry)", () => {
    for (const n of ["ThrottlingException", "ServiceUnavailableException", "ModelTimeoutException", "ModelNotReadyException"]) {
      expect(isHardLlmError(awsErr(n))).toBe(false);
    }
  });

  it("keys off an HTTP status: 4xx client errors are HARD, except 408/429 (transient), and 5xx transient", () => {
    for (const s of [400, 401, 403, 404, 422]) expect(isHardLlmError(metaErr(s))).toBe(true);
    for (const s of [408, 429, 500, 502, 503]) expect(isHardLlmError(metaErr(s))).toBe(false);
    // Gemini-SDK-shaped `.status`, and the openai/openrouter adapters that embed it in the message.
    expect(isHardLlmError(Object.assign(new Error("x"), { status: 401 }))).toBe(true);
    expect(isHardLlmError(Object.assign(new Error("x"), { status: 429 }))).toBe(false);
    expect(isHardLlmError(new Error("OpenAI request failed (403): forbidden"))).toBe(true);
    expect(isHardLlmError(new Error("OpenAI request failed (500): server error"))).toBe(false);
    expect(isHardLlmError(new Error("OpenRouter request failed (429): rate limited"))).toBe(false);
  });

  it("classifies a missing API key, auth language, and model-not-found by message as HARD", () => {
    expect(isHardLlmError(new Error("GEMINI_API_KEY is not set."))).toBe(true);
    expect(isHardLlmError(new Error("OPENAI_API_KEY is not set."))).toBe(true);
    expect(isHardLlmError(new Error("Unauthorized: invalid api key"))).toBe(true);
    expect(isHardLlmError(new Error("The model gpt-5o does not exist"))).toBe(true);
    expect(isHardLlmError(new Error("model_not_found"))).toBe(true);
  });

  it("defaults ambiguous / timeout / abort / empty-reply failures to TRANSIENT", () => {
    expect(isHardLlmError(new Error("Gemini request timed out."))).toBe(false);
    expect(isHardLlmError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(false);
    expect(isHardLlmError(new Error("Empty response from Gemini."))).toBe(false);
    expect(isHardLlmError(new Error("No JSON value found in model output"))).toBe(false);
    expect(isHardLlmError(null)).toBe(false);
    expect(isHardLlmError("a string, not an error")).toBe(false);
  });
});

describe("shouldRetrySameProvider — hard→skip · transient→retry · budget-starved→skip to fallback", () => {
  const TOTAL = 90_000; // hosted default; reserve per step = floor(TOTAL/3)=30_000, retry needs 60_000 free
  const hard = Object.assign(new Error("denied"), { name: "AccessDeniedException" });
  const transient = new Error("Gemini request timed out.");

  it("HARD error never retries the same provider (regardless of budget or fallback)", () => {
    expect(shouldRetrySameProvider({ lastError: hard, hasFallback: true, remainingBudgetMs: TOTAL, totalBudgetMs: TOTAL })).toBe(false);
    expect(shouldRetrySameProvider({ lastError: hard, hasFallback: false, remainingBudgetMs: TOTAL, totalBudgetMs: TOTAL })).toBe(false);
  });

  it("TRANSIENT error retries when the budget can still fit both a retry and the fallback", () => {
    expect(shouldRetrySameProvider({ lastError: transient, hasFallback: true, remainingBudgetMs: TOTAL, totalBudgetMs: TOTAL })).toBe(true);
    // Boundary: exactly the reserve for both steps → still retries (guard is strict <).
    expect(shouldRetrySameProvider({ lastError: transient, hasFallback: true, remainingBudgetMs: 60_000, totalBudgetMs: TOTAL })).toBe(true);
  });

  it("TRANSIENT error skips the retry (to the fallback) when the remaining budget can't fit both", () => {
    expect(shouldRetrySameProvider({ lastError: transient, hasFallback: true, remainingBudgetMs: 59_999, totalBudgetMs: TOTAL })).toBe(false);
    expect(shouldRetrySameProvider({ lastError: transient, hasFallback: true, remainingBudgetMs: 10_000, totalBudgetMs: TOTAL })).toBe(false);
  });

  it("with NO fallback there's nothing to preserve, so a transient failure still retries even on a starved budget", () => {
    expect(shouldRetrySameProvider({ lastError: transient, hasFallback: false, remainingBudgetMs: 1, totalBudgetMs: TOTAL })).toBe(true);
  });
});

describe("scanRepository — budget-aware retry wiring (end-to-end)", () => {
  beforeEach(() => {
    vi.stubEnv("GITHUB_TOKEN", "");
    vi.stubEnv("LLM_FALLBACK_PROVIDER", "");
    llmControl.primary = null;
    llmControl.fallback = null;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    llmControl.primary = null;
    llmControl.fallback = null;
  });

  it("a HARD primary failure skips the same-provider retry and goes STRAIGHT to the failover", async () => {
    const { source } = mockSource("treesha-aaa");
    // Primary throws an auth error (HARD) on the FIRST call; if it were retried it would be called twice.
    llmControl.primary = fakeProvider("gemini", [
      { kind: "throw", error: Object.assign(new Error("bedrock access denied"), { name: "AccessDeniedException" }) },
    ]);
    llmControl.fallback = fakeProvider("openai", [{ kind: "usable", usage: { inputTokens: 10, outputTokens: 5 } }]);
    vi.stubEnv("LLM_FALLBACK_PROVIDER", "openai");

    const report = await scanRepository("o/r", { source, now: NOW });

    expect(report.engine.provider).toBe("openai"); // recovered via failover
    // THE INVARIANT: the doomed same-provider retry was skipped — primary was called exactly once.
    expect(llmControl.primary.calls).toBe(1);
    expect(llmControl.fallback.calls).toBe(1);
  });

  it("a TRANSIENT primary failure still RETRIES the same provider before failing over", async () => {
    const { source } = mockSource("treesha-aaa");
    // Every primary attempt throws a transient error; ample default budget ⇒ the retry runs.
    llmControl.primary = fakeProvider("gemini", [{ kind: "throw", error: new Error("Gemini request timed out.") }]);
    llmControl.fallback = fakeProvider("openai", [{ kind: "usable", usage: { inputTokens: 10, outputTokens: 5 } }]);
    vi.stubEnv("LLM_FALLBACK_PROVIDER", "openai");

    const report = await scanRepository("o/r", { source, now: NOW });

    expect(report.engine.provider).toBe("openai");
    // Transient ⇒ primary got its second (retry) chance before the failover.
    expect(llmControl.primary.calls).toBe(2);
  });

  it("a HARD primary failure with NO fallback degrades to a labeled mock WITHOUT a wasted retry", async () => {
    const { source } = mockSource("treesha-aaa");
    llmControl.primary = fakeProvider("gemini", [
      { kind: "throw", error: Object.assign(new Error("no creds"), { name: "UnrecognizedClientException" }) },
    ]);
    const report = await scanRepository("o/r", { source, now: NOW });

    expect(report.engine.provider).toBe("mock");
    expect(llmControl.primary.calls).toBe(1); // hard error ⇒ no doomed retry, straight to the floor
    expect(report.warnings ?? []).toContain(
      "AI analysis was unavailable, so scores reflect detected signals only (no qualitative nuance).",
    );
  });
});

// ---------------------------------------------------------------------------
// resolveScanAuth — authorize-before-mint cross-tenant gate (scan.ts:77-102, #4).
// This is the security boundary that decides whether a PRIVATE-repo scan is
// authorized. The core invariant: an installation token is minted ONLY when the
// session is authorized for that installation/org (or auth is disabled) — never
// on an unauthorized caller-supplied id, never on the owner's stored id for a
// caller who doesn't own the org. The deny path resolves to {orgSlug:"public"}
// with NO token, and crucially does so BEFORE any mint (getInstallationToken is
// never called). Anonymous/public scans (no parsed repo, app unconfigured)
// resolve to the public org with no private token.
// ---------------------------------------------------------------------------
const PARSED: ParsedRepo = { owner: "AcmeCorp", repo: "secret-svc" };

describe("resolveScanAuth — authorize-before-mint cross-tenant gate (#4)", () => {
  beforeEach(() => {
    authControl.appConfigured = true;
    authControl.authConfigured = true;
    authControl.canMintInstallationToken.mockReset().mockResolvedValue(false);
    authControl.getInstallationIdForOwner.mockReset().mockResolvedValue(null);
    authControl.getInstallationToken.mockReset().mockResolvedValue("ghs_tok");
  });

  it("PROD SHAPE: an unauthorized caller gets no token AND no ambient operator PAT", async () => {
    // The regression this whole suite exists for. Under the Supabase wall the old predicate allowed
    // ANY caller to mint. Now the gate denies — and because the owner IS an installed org (its repos
    // may be private), the ambient GITHUB_TOKEN must be refused too, or scanRepository would fall
    // back to the operator PAT and read the very repo the gate just denied.
    authControl.canMintInstallationToken.mockResolvedValue(false);
    authControl.getInstallationIdForOwner.mockResolvedValue("owner-install-42");

    const res = await resolveScanAuth(PARSED);

    expect(res).toEqual({ orgSlug: "public", noAmbientToken: true });
    expect(res.token).toBeUndefined();
    expect(authControl.canMintInstallationToken).toHaveBeenCalledWith("AcmeCorp");
    // THE INVARIANT: denied BEFORE minting.
    expect(authControl.getInstallationToken).not.toHaveBeenCalled();
  });

  it("DENIES a caller-supplied installationId that is not this owner's — and NEVER mints", async () => {
    // Cross-tenant IDOR attempt: pass a victim's enumerable id. Even an authorized caller may only
    // ever mint the installation belonging to the owner they are scanning.
    authControl.canMintInstallationToken.mockResolvedValue(true);
    authControl.getInstallationIdForOwner.mockResolvedValue("owner-install-42");

    const res = await resolveScanAuth(PARSED, "victim-install-99");

    expect(res).toEqual({ orgSlug: "public", noAmbientToken: true });
    expect(authControl.getInstallationToken).not.toHaveBeenCalled();
  });

  it("PUBLIC FUNNEL: an owner with no installation keeps the ambient PAT (anonymous public scans)", async () => {
    // Regression guard for the free funnel: scanning `facebook/react` anonymously must still use the
    // ambient GITHUB_TOKEN for GitHub rate limits. noAmbientToken must NOT be set here.
    authControl.getInstallationIdForOwner.mockResolvedValue(null);

    const res = await resolveScanAuth(PARSED);

    expect(res).toEqual({ orgSlug: "public" });
    expect(res.noAmbientToken).toBeUndefined();
    // Nothing to mint ⇒ the gate is never consulted.
    expect(authControl.canMintInstallationToken).not.toHaveBeenCalled();
    expect(authControl.getInstallationToken).not.toHaveBeenCalled();
  });

  it("MINTS the owner's stored installation for an authorized caller (no supplied id)", async () => {
    authControl.canMintInstallationToken.mockResolvedValue(true);
    authControl.getInstallationIdForOwner.mockResolvedValue("owner-install-42");
    authControl.getInstallationToken.mockResolvedValue("ghs_owner");

    const res = await resolveScanAuth(PARSED);

    expect(res).toEqual({ token: "ghs_owner", orgSlug: "acmecorp" }); // lowercased slug for persistence
    expect(authControl.getInstallationToken).toHaveBeenCalledWith("owner-install-42");
  });

  it("MINTS when the supplied installationId matches the owner's stored one", async () => {
    authControl.canMintInstallationToken.mockResolvedValue(true);
    authControl.getInstallationIdForOwner.mockResolvedValue("owner-install-42");
    authControl.getInstallationToken.mockResolvedValue("ghs_supplied");

    const res = await resolveScanAuth(PARSED, "owner-install-42");

    expect(res).toEqual({ token: "ghs_supplied", orgSlug: "acmecorp" });
    expect(authControl.getInstallationToken).toHaveBeenCalledWith("owner-install-42");
  });

  it("a failed mint for an authorized caller still refuses the operator PAT", async () => {
    authControl.canMintInstallationToken.mockResolvedValue(true);
    authControl.getInstallationIdForOwner.mockResolvedValue("owner-install-42");
    authControl.getInstallationToken.mockRejectedValue(new Error("GitHub 503"));

    const res = await resolveScanAuth(PARSED);

    expect(res).toEqual({ orgSlug: "public", noAmbientToken: true });
  });

  it("auth-off (local/demo): the shared gate allows, so the owner's installation is used", async () => {
    // canMintInstallationToken itself encodes the auth-off branch (see authz.test.ts); resolveScanAuth
    // simply honors its verdict.
    authControl.authConfigured = false;
    authControl.canMintInstallationToken.mockResolvedValue(true);
    authControl.getInstallationIdForOwner.mockResolvedValue("owner-install-42");
    authControl.getInstallationToken.mockResolvedValue("ghs_localdemo");

    const res = await resolveScanAuth(PARSED);

    expect(res).toEqual({ token: "ghs_localdemo", orgSlug: "acmecorp" });
    expect(authControl.getInstallationToken).toHaveBeenCalledWith("owner-install-42");
  });

  it("resolves anonymous/public scans to the public org with NO token (app unconfigured or no repo)", async () => {
    authControl.appConfigured = false;
    const res = await resolveScanAuth(PARSED, "any-install");
    expect(res).toEqual({ orgSlug: "public" });
    expect(authControl.getInstallationToken).not.toHaveBeenCalled();

    authControl.appConfigured = true;
    const resNull = await resolveScanAuth(null, "any-install");
    expect(resNull).toEqual({ orgSlug: "public" });
    expect(authControl.getInstallationToken).not.toHaveBeenCalled();
  });

  it("degrades to the public org when an AUTHORIZED mint throws on a supplied id", async () => {
    authControl.canMintInstallationToken.mockResolvedValue(true);
    authControl.getInstallationIdForOwner.mockResolvedValue("my-install-7");
    authControl.getInstallationToken.mockRejectedValue(new Error("GitHub App key revoked"));

    const res = await resolveScanAuth(PARSED, "my-install-7");

    // Degrades, but never to the operator PAT — the owner is an installed (private-capable) org.
    expect(res).toEqual({ orgSlug: "public", noAmbientToken: true });
    expect(res.token).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Standing-decision scoping (individual tier, decision 5): the slug scanRepository
// reads decisions from is decisionOrgSlug ?? orgSlug. The public funnel passes the
// TRIGGERING viewer's personal org; org scans keep their own slug; an anonymous
// public scan reads nothing. A regression here either leaks one viewer's decisions
// into everyone's scans or silently stops injecting them at all.
// ---------------------------------------------------------------------------
describe("scanRepository — standing-decision scoping (decisionOrgSlug)", () => {
  beforeEach(() => {
    dbControl.decisionsForRepo.mockReset();
    dbControl.decisionsForRepo.mockResolvedValue([]);
  });

  it("reads from decisionOrgSlug when set (the viewer's personal org on the public funnel)", async () => {
    const { source } = mockSource("a".repeat(40));
    await scanRepository("o/r", { mock: true, source, now: NOW, orgSlug: "public", decisionOrgSlug: "alice" });
    expect(dbControl.decisionsForRepo).toHaveBeenCalledWith("alice", "o/r");
  });

  it("falls back to orgSlug when decisionOrgSlug is absent (org scans unchanged)", async () => {
    const { source } = mockSource("b".repeat(40));
    await scanRepository("o/r", { mock: true, source, now: NOW, orgSlug: "acme" });
    expect(dbControl.decisionsForRepo).toHaveBeenCalledWith("acme", "o/r");
  });

  it("skips the read entirely when neither slug is set (anonymous public scan)", async () => {
    const { source } = mockSource("c".repeat(40));
    await scanRepository("o/r", { mock: true, source, now: NOW });
    expect(dbControl.decisionsForRepo).not.toHaveBeenCalled();
  });
});
