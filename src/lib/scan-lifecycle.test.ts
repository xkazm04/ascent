// THE REFUND-LEDGER PARITY TABLE, plus the coordinate/authoritative contracts of the one scan
// lifecycle both single-repo entry points run.
//
// /api/scan and /api/scan/stream used to hand-sequence the same post-gate run (coordinate, scope,
// head + cache lookup, cached return, coalesce, classify, refund, cache and persist, salvage) in two
// files, and the copies had drifted: a coalesce joiner refunded the credit on the stream and only the
// quota on the JSON route. "Harmless today" rested on an invariant nothing pinned - that coalescing
// only ever happens on the unmetered anonymous path.
//
// This file pins the ledger as a TABLE over the shared lifecycle: for each no-delivery situation, which
// of the two meters is handed back. The route-level half of the same claim (both entry points reaching
// this one ledger) lives in src/app/api/scan/gate-order.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ScanReport } from "@/lib/types";
import type { ScanCacheLookup } from "@/lib/scan-cache";
import type { ResolvedScanScope } from "@/lib/scan-scope-server";

vi.mock("@/lib/scan", () => ({ scanRepository: vi.fn() }));
vi.mock("@/lib/scan-cache", () => ({
  lookupCachedScan: vi.fn(),
  lookupScopedScan: vi.fn(),
  resolveHeadWithHint: vi.fn(async () => null),
}));
vi.mock("@/lib/cache", () => ({
  cacheSet: vi.fn(),
  coalesceScan: vi.fn(
    (_key: string, factory: (s: AbortSignal, emit: (p: unknown) => void) => Promise<ScanReport>) =>
      factory(new AbortController().signal, () => {}),
  ),
}));
vi.mock("@/lib/db", () => ({
  isDbConfigured: vi.fn(() => false),
  persistScanReport: vi.fn(async () => ({ deduped: false })),
  getScanReportByCommit: vi.fn(async () => null),
  getOrgId: vi.fn(async () => null),
  recordQuotaEvent: vi.fn(async () => {}),
}));
vi.mock("@/lib/scan-alerts", () => ({
  maybeAlertLowCredits: vi.fn(async () => {}),
  checkAndAlertRegression: vi.fn(async () => ({ regressed: false, verdict: null, dispatched: false })),
}));
vi.mock("@/lib/access", () => ({ authGateEnabled: () => false, getViewer: vi.fn(async () => null) }));

import {
  createScanRefundLedger,
  isAuthoritativeScanResult,
  resolveScanCoordinate,
  resolveScanTarget,
  runScanLifecycle,
  type ScanLifecycleAdapter,
} from "@/lib/scan-lifecycle";
import { scanRepository } from "@/lib/scan";
import { lookupCachedScan } from "@/lib/scan-cache";
import { coalesceScan } from "@/lib/cache";
import { isDbConfigured, persistScanReport } from "@/lib/db";

const mockScan = vi.mocked(scanRepository);
const mockLookup = vi.mocked(lookupCachedScan);
const mockCoalesce = vi.mocked(coalesceScan);
const mockDbConfigured = vi.mocked(isDbConfigured);
const mockPersist = vi.mocked(persistScanReport);

const UNSCOPED_INPUT: ResolvedScanScope = { error: null, scope: {}, pinSha: null, requested: false };

const reportWith = (provider: string): ScanReport =>
  ({
    repo: { owner: "o", name: "r", headSha: "sha", isPrivate: false },
    engine: { provider, model: "m" },
    warnings: [],
    confidence: 0.9,
  }) as unknown as ScanReport;

const lookupOf = (cached: ScanReport | null = null): ScanCacheLookup => ({
  cacheKey: "o/r@sha::llm",
  headSha: "sha",
  etag: "e",
  cached,
  source: cached ? "memory" : null,
});

/** A protocol-free adapter: every delivery path collapses to a tag so the table can assert refunds. */
function stubAdapter(): ScanLifecycleAdapter<string> {
  return {
    tag: "test",
    deliverCached: () => "cached",
    deliverResult: () => "result",
    deliverFailure: () => "failure",
  };
}

async function runWithLedger(opts: { mock?: boolean } = {}) {
  const refundQuota = vi.fn(async () => {});
  const refundCredit = vi.fn(async () => {});
  const ledger = createScanRefundLedger({ refundQuota, refundCredit });
  const out = await runScanLifecycle(
    {
      url: "o/r",
      coordinate: resolveScanCoordinate("o/r"),
      orgSlug: "public",
      token: undefined,
      noAmbientToken: false,
      scoping: UNSCOPED_INPUT,
      mock: opts.mock ?? false,
      fresh: false,
      ledger,
    },
    stubAdapter(),
  );
  return { out, quota: refundQuota.mock.calls.length, credit: refundCredit.mock.calls.length };
}

/** The six no-delivery (or no-new-product) situations the lifecycle meters on, and the two meters. */
const SITUATIONS = [
  {
    name: "cached hit",
    arrange: () => mockLookup.mockResolvedValue(lookupOf(reportWith("gemini"))),
    quota: 1,
    credit: 1,
    out: "cached",
  },
  {
    name: "coalesce join",
    arrange: () => {
      mockLookup.mockResolvedValue(lookupOf());
      mockScan.mockResolvedValue(reportWith("gemini"));
      // Drive the join callback the way coalesceScan does for a caller that attached to a live run.
      mockCoalesce.mockImplementation(
        async (
          _key: string,
          factory: (s: AbortSignal, emit: (p: never) => void) => Promise<ScanReport>,
          _signal?: AbortSignal,
          onJoin?: () => void,
        ) => {
          onJoin?.();
          return factory(new AbortController().signal, () => {});
        },
      );
    },
    quota: 1,
    credit: 1,
    out: "result",
  },
  {
    name: "degrade-to-mock",
    arrange: () => {
      mockLookup.mockResolvedValue(lookupOf());
      mockScan.mockResolvedValue(reportWith("mock"));
    },
    quota: 1,
    credit: 1,
    out: "result",
  },
  {
    name: "dedup",
    arrange: () => {
      mockLookup.mockResolvedValue(lookupOf());
      mockScan.mockResolvedValue(reportWith("gemini"));
      mockDbConfigured.mockReturnValue(true);
      mockPersist.mockResolvedValue({ deduped: true } as Awaited<ReturnType<typeof persistScanReport>>);
    },
    // A dedup DELIVERED a report (the existing snapshot), so the free monthly slot stands; only the
    // reserved credit is handed back ("a dedup run is free").
    quota: 0,
    credit: 1,
    out: "result",
  },
  {
    name: "thrown error",
    arrange: () => {
      mockLookup.mockResolvedValue(lookupOf());
      mockScan.mockRejectedValue(new Error("github exploded"));
    },
    quota: 1,
    credit: 1,
    out: "failure",
  },
  {
    name: "client abort",
    arrange: () => {
      mockLookup.mockResolvedValue(lookupOf());
      const abort = new Error("aborted");
      abort.name = "AbortError";
      mockScan.mockRejectedValue(abort);
    },
    quota: 1,
    credit: 1,
    out: "failure",
  },
] as const;

describe("scan lifecycle - refund-ledger parity table", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbConfigured.mockReturnValue(false);
    mockPersist.mockResolvedValue({ deduped: false } as Awaited<ReturnType<typeof persistScanReport>>);
    mockCoalesce.mockImplementation(
      async (_key: string, factory: (s: AbortSignal, emit: (p: never) => void) => Promise<ScanReport>) =>
        factory(new AbortController().signal, () => {}),
    );
  });

  it.each(SITUATIONS)("$name refunds quota x$quota and credit x$credit", async (situation) => {
    situation.arrange();
    const run = await runWithLedger();
    expect(run.out).toBe(situation.out);
    expect(run.quota).toBe(situation.quota);
    expect(run.credit).toBe(situation.credit);
  });

  it("a real, newly-scored scan refunds NEITHER meter", async () => {
    mockLookup.mockResolvedValue(lookupOf());
    mockScan.mockResolvedValue(reportWith("gemini"));
    const run = await runWithLedger();
    expect(run).toMatchObject({ out: "result", quota: 0, credit: 0 });
  });
});

describe("resolveScanCoordinate - the live path is forge-capable", () => {
  it("routes a GitLab coordinate the scan form emits", () => {
    const c = resolveScanCoordinate("gitlab:group/project");
    expect(c.forgeId).toBe("gitlab");
    expect(c.parsed).toMatchObject({ owner: "group", repo: "project" });
    // Every GitHub-keyed side path (installation auth, conditional head, scan cache, ref resolve) is
    // gated on ghParsed, so a non-GitHub scan takes the token-less path and degrades honestly.
    expect(c.ghParsed).toBeNull();
    expect(c.repoIdentity).toBe("gitlab:group/project");
  });

  it("is byte-identical to the GitHub parser on a GitHub input", () => {
    const c = resolveScanCoordinate("https://github.com/o/r");
    expect(c.forgeId).toBe("github");
    expect(c.ghParsed).toMatchObject({ owner: "o", repo: "r" });
    expect(c.repoIdentity).toBe("o/r");
  });

  it("reports an unparseable URL as a null coordinate", () => {
    expect(resolveScanCoordinate("not a repo at all!!").parsed).toBeNull();
  });
});

describe("resolveScanTarget - the cache head lookup honours noAmbientToken (lite r1, robustness-1)", () => {
  const PAT = "ghp_operator_pat";
  const target = (noAmbientToken: boolean) =>
    resolveScanTarget({
      coordinate: resolveScanCoordinate("https://github.com/installed-org/private-repo"),
      scoping: UNSCOPED_INPUT,
      token: undefined,
      noAmbientToken,
      mock: false,
      fresh: false,
    });

  beforeEach(() => {
    vi.stubEnv("GITHUB_TOKEN", PAT);
    mockLookup.mockReset().mockResolvedValue({ cacheKey: "k", headSha: null, etag: null, cached: null, source: null });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("an anonymous peek at an installed owner's private repo hands the lookup no credential", async () => {
    await target(true);
    expect(mockLookup).toHaveBeenCalledTimes(1);
    expect(mockLookup).toHaveBeenCalledWith(expect.objectContaining({ token: undefined }));
    expect(mockLookup.mock.calls[0]![0].token).not.toBe(PAT);
  });

  it("an ordinary anonymous scan still resolves the head with the ambient PAT", async () => {
    await target(false);
    expect(mockLookup).toHaveBeenCalledWith(expect.objectContaining({ token: PAT }));
  });
});

describe("isAuthoritativeScanResult - a NEW poisoning vector needs no route edit", () => {
  it("treats any truthy flag on the classification as poisoning", () => {
    expect(isAuthoritativeScanResult({ degradedToMock: false, lowCoverage: false, partialPrSlice: false })).toBe(true);
    // The vector a future classifyScanResult adds. The predicate is written over the classification's
    // VALUES, not an enumerated list, so persistence and the completion email both close behind it.
    expect(
      isAuthoritativeScanResult({
        degradedToMock: false,
        lowCoverage: false,
        partialPrSlice: false,
        truncatedSnapshot: true,
      } as never),
    ).toBe(false);
  });
});
