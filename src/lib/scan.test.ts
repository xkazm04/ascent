// Regression tests for SHA-drift prevention (scan-and-decide idea 744fc886): when the routes
// pass the head sha already resolved for the cache key, the scan must pin ingestion to it and
// stamp it as the report's commit identity — so the cache key and the scored commit agree even
// if a push lands between the head lookup and the tree read. An explicit PR `ref` still wins.
//
// A mock RepoSource keeps this fully offline; mock:true + no token avoids every network call.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { scanRepository, resolveScanAuth } from "./scan";
import type { FetchOptions, ParsedRepo, RepoSource } from "@/lib/github/source";
import type { LlmAssessment, RepoSnapshot, TokenUsage } from "@/lib/types";
import type { AssessOptions, LLMProvider, LlmScoreInput } from "@/lib/llm/provider";

// ---------------------------------------------------------------------------
// Auth-dependency harness for the resolveScanAuth cross-tenant gate suite
// (scan.ts:77-102). resolveScanAuth authorizes BEFORE minting an installation
// token: a caller-supplied installationId must belong to the session
// (sessionHasInstallation), and the repo-owner's stored installation is used
// only for a caller who owns that org (sessionOwnsOrg); only then is
// getInstallationToken called. Mock every dep with a vi.fn() so each branch is
// driven deterministically and the authorize-before-mint ordering is asserted
// (the mint fn must NOT be called on a deny path). These mocks are inert for
// the scanRepository suites above — they never invoke resolveScanAuth.
const authControl = {
  appConfigured: true,
  authConfigured: true,
  sessionHasInstallation: vi.fn<(id: string) => Promise<boolean>>(),
  sessionOwnsOrg: vi.fn<(owner: string) => Promise<boolean>>(),
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
    sessionHasInstallation: (id: string) => authControl.sessionHasInstallation(id),
    sessionOwnsOrg: (owner: string) => authControl.sessionOwnsOrg(owner),
  };
});
vi.mock("@/lib/db", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/db")>();
  return {
    ...actual,
    getInstallationIdForOwner: (owner: string) => authControl.getInstallationIdForOwner(owner),
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
    // Failover lookup — return the test-installed fallback (or null = "no real fallback",
    // which makes scan.ts degrade straight to its own MockProvider).
    providerByName: () => llmControl.fallback,
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
    authControl.sessionHasInstallation.mockReset().mockResolvedValue(false);
    authControl.sessionOwnsOrg.mockReset().mockResolvedValue(false);
    authControl.getInstallationIdForOwner.mockReset().mockResolvedValue(null);
    authControl.getInstallationToken.mockReset().mockResolvedValue("ghs_tok");
  });

  it("DENIES a caller-supplied installationId the session does NOT own — public org, and NEVER mints (authorize-before-mint)", async () => {
    // Cross-tenant IDOR attempt: an anonymous caller passes another tenant's enumerable id.
    authControl.sessionHasInstallation.mockResolvedValue(false);
    // No owner-stored fallback either (caller doesn't own the org).
    authControl.sessionOwnsOrg.mockResolvedValue(false);
    authControl.getInstallationIdForOwner.mockResolvedValue("owner-install-42");

    const res = await resolveScanAuth(PARSED, "victim-install-99");

    expect(res).toEqual({ orgSlug: "public" });
    expect(res.token).toBeUndefined();
    // THE INVARIANT: the gate denied BEFORE minting — the supplied id was checked,
    // and getInstallationToken was never reached on the deny path.
    expect(authControl.sessionHasInstallation).toHaveBeenCalledWith("victim-install-99");
    expect(authControl.getInstallationToken).not.toHaveBeenCalled();
  });

  it("does NOT mint the OWNER'S stored installation for a caller who doesn't own the org", async () => {
    // No supplied id; the owner HAS a stored installation, but the session doesn't own the org.
    authControl.sessionOwnsOrg.mockResolvedValue(false);
    authControl.getInstallationIdForOwner.mockResolvedValue("owner-install-42");

    const res = await resolveScanAuth(PARSED);

    expect(res).toEqual({ orgSlug: "public" });
    // Ownership was checked and FAILED — the stored id is never looked up, and nothing is minted.
    expect(authControl.sessionOwnsOrg).toHaveBeenCalledWith("AcmeCorp");
    expect(authControl.getInstallationIdForOwner).not.toHaveBeenCalled();
    expect(authControl.getInstallationToken).not.toHaveBeenCalled();
  });

  it("MINTS the supplied installationId when the session owns it — authorized caller gets the org + token", async () => {
    authControl.sessionHasInstallation.mockResolvedValue(true);
    authControl.getInstallationToken.mockResolvedValue("ghs_supplied");

    const res = await resolveScanAuth(PARSED, "my-install-7");

    expect(res.orgSlug).toBe("acmecorp"); // lowercased owner slug for persistence
    expect(res.token).toBe("ghs_supplied");
    // Minted for the SUPPLIED, session-owned id — not the owner's stored id (never consulted).
    expect(authControl.getInstallationToken).toHaveBeenCalledWith("my-install-7");
    expect(authControl.getInstallationIdForOwner).not.toHaveBeenCalled();
  });

  it("MINTS the owner's stored installation when the caller OWNS the org (no supplied id)", async () => {
    authControl.sessionOwnsOrg.mockResolvedValue(true);
    authControl.getInstallationIdForOwner.mockResolvedValue("owner-install-42");
    authControl.getInstallationToken.mockResolvedValue("ghs_owner");

    const res = await resolveScanAuth(PARSED);

    expect(res).toEqual({ token: "ghs_owner", orgSlug: "acmecorp" });
    expect(authControl.getInstallationToken).toHaveBeenCalledWith("owner-install-42");
  });

  it("auth-off (local/demo): uses the owner's stored installation WITHOUT any session check", async () => {
    authControl.authConfigured = false;
    authControl.getInstallationIdForOwner.mockResolvedValue("owner-install-42");
    authControl.getInstallationToken.mockResolvedValue("ghs_localdemo");

    const res = await resolveScanAuth(PARSED);

    expect(res).toEqual({ token: "ghs_localdemo", orgSlug: "acmecorp" });
    // Auth disabled ⇒ the session-authorization checks are skipped entirely.
    expect(authControl.sessionHasInstallation).not.toHaveBeenCalled();
    expect(authControl.sessionOwnsOrg).not.toHaveBeenCalled();
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

  it("degrades to the public org (no token) when an AUTHORIZED mint throws", async () => {
    authControl.sessionHasInstallation.mockResolvedValue(true);
    authControl.getInstallationToken.mockRejectedValue(new Error("GitHub App key revoked"));

    const res = await resolveScanAuth(PARSED, "my-install-7");

    expect(res).toEqual({ orgSlug: "public" });
    expect(res.token).toBeUndefined();
  });
});
