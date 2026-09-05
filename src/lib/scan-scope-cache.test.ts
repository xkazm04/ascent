// THE collision contract for ref-scoped and sub-path-scoped scans (G7-07 / G7-08).
//
// The scan cache and the persisted Scan row are keyed on a commit sha. Exposing a branch selector is
// only safe if a ref-scoped scan can never land on — or be served from — the entry a default-branch
// scan owns, and if its (differently-scoped) report never reaches the shared corpus. Each of those is
// asserted directly here rather than inferred from the route code.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { cacheGet, cacheSet, makeCacheKey } from "./cache";
import { lookupScopedScan } from "./scan-cache";
import { cacheAndPersistScan, classifyScanResult } from "./scan-finalize";
import type { ScanReport } from "@/lib/types";

vi.mock("@/lib/db", () => ({
  getHeadHint: vi.fn(),
  getScanReportByCommit: vi.fn(async () => null),
  getOrgId: vi.fn(async () => "org-1"),
  isDbConfigured: vi.fn(() => true),
  persistScanReport: vi.fn(async () => ({ deduped: false })),
}));
vi.mock("@/lib/access", () => ({ getViewer: vi.fn(async () => null) }));
vi.mock("@/lib/scan-alerts", () => ({ checkAndAlertRegression: vi.fn(async () => null) }));
vi.mock("@/lib/memory/scan-feed", () => ({ recordScanMemories: vi.fn(async () => {}) }));
vi.mock("@/lib/public-scan-quota", () => ({
  consumePublicScanQuota: vi.fn(),
  refundPublicScanQuota: vi.fn(),
  monthlyQuotaExceeded: vi.fn(),
}));

import { isDbConfigured, persistScanReport } from "@/lib/db";

const IDENTITY = { provider: "p", model: "m", rubric: "r3" };
const HEAD = "a".repeat(40);
const BRANCH = "b".repeat(40);
const parsed = { owner: "octo", repo: "mono" };

/** Minimal report — only the fields the finalize path and the freshness gate read. */
const report = (overrides: Partial<ScanReport> = {}) =>
  ({
    repo: { owner: "octo", name: "mono", isPrivate: false },
    engine: { provider: "gemini", model: "m", rubricVersion: "r3" },
    confidence: 0.9,
    scannedAt: new Date().toISOString(),
    ...overrides,
  }) as unknown as ScanReport;

describe("cache KEY — a scoped scan can never collide with a default-branch scan", () => {
  it("a ref that resolves to its OWN commit keys a different entry than the default head", () => {
    // The whole point of resolving the ref server-side: if a `develop` scan were keyed by the DEFAULT
    // head sha (the value lookupCachedScan resolves), the two would be one entry.
    const defaultKey = makeCacheKey("octo", "mono", true, HEAD, IDENTITY);
    const refKey = makeCacheKey("octo", "mono", true, BRANCH, IDENTITY);
    expect(refKey).not.toBe(defaultKey);
  });

  it("a sub-path scan at the SAME commit keys a different entry than the whole-repo scan", () => {
    // A sub-path reads a different file set at an identical sha, so the sha alone cannot identify it.
    const whole = makeCacheKey("octo", "mono", true, HEAD, IDENTITY);
    const scoped = makeCacheKey("octo", "mono", true, HEAD, IDENTITY, "path:packages/api");
    expect(scoped).not.toBe(whole);
  });

  it("two different sub-paths at one commit key different entries", () => {
    const a = makeCacheKey("octo", "mono", true, HEAD, IDENTITY, "path:packages/api");
    const b = makeCacheKey("octo", "mono", true, HEAD, IDENTITY, "path:packages/web");
    expect(a).not.toBe(b);
  });

  it("omitting the scope reproduces the pre-scope key byte-for-byte (no fleet-wide invalidation)", () => {
    expect(makeCacheKey("octo", "mono", true, HEAD, IDENTITY, undefined)).toBe(
      makeCacheKey("octo", "mono", true, HEAD, IDENTITY),
    );
    expect(makeCacheKey("octo", "mono", true, HEAD, IDENTITY, null)).toBe(
      makeCacheKey("octo", "mono", true, HEAD, IDENTITY),
    );
  });
});

describe("lookupScopedScan — cache tier behavior", () => {
  it("pins the key to the REF's own sha, never the default head", () => {
    const l = lookupScopedScan({ parsed, useLLM: true, refSha: BRANCH });
    expect(l.headSha).toBe(BRANCH);
    expect(l.cacheKey).toContain(`@${BRANCH}`);
    expect(l.cacheKey).not.toContain(HEAD);
  });

  it("adds the sub-path segment so a scoped reader can't be served the whole-repo entry", () => {
    // Seed the WHOLE-REPO entry for this exact commit, then ask for the sub-path scan at the same
    // commit: it must miss. This is the sub-path half of the collision contract.
    const wholeKey = makeCacheKey("octo", "mono", true, HEAD);
    cacheSet(wholeKey, report());
    const scoped = lookupScopedScan({ parsed, useLLM: true, refSha: HEAD, subPath: "packages/api" });
    expect(scoped.cacheKey).not.toBe(wholeKey);
    expect(scoped.cached).toBeNull();
  });

  it("a scoped WRITE cannot be read by a whole-repo reader of the same commit", () => {
    const scoped = lookupScopedScan({ parsed, useLLM: true, refSha: HEAD, subPath: "packages/only" });
    cacheSet(scoped.cacheKey, report({ confidence: 0.11 } as Partial<ScanReport>));
    // The unscoped reader's key is untouched by the scoped write.
    expect(cacheGet(makeCacheKey("octo", "mono", true, HEAD))?.confidence).not.toBe(0.11);
    // …while the scoped reader gets its own entry back.
    expect(lookupScopedScan({ parsed, useLLM: true, refSha: HEAD, subPath: "packages/only" }).cached?.confidence).toBe(0.11);
  });

  it("never consults the DB tier and never carries an ETag", () => {
    // Persisted rows are keyed (repo, headSha) with NO notion of scope, and the head ETag re-validates
    // the DEFAULT branch — neither is meaningful for a scoped scan.
    const l = lookupScopedScan({ parsed, useLLM: true, refSha: BRANCH, subPath: "packages/api" });
    expect(l.etag).toBeNull();
    expect(l.source).toBeNull();
  });

  it("fresh=1 skips the in-memory hit but keeps the key (so the re-run still caches + coalesces)", () => {
    const seeded = lookupScopedScan({ parsed, useLLM: true, refSha: BRANCH, subPath: "packages/x" });
    cacheSet(seeded.cacheKey, report());
    const refetch = lookupScopedScan({ parsed, useLLM: true, refSha: BRANCH, subPath: "packages/x", fresh: true });
    expect(refetch.cached).toBeNull();
    expect(refetch.cacheKey).toBe(seeded.cacheKey);
  });
});

describe("PERSISTENCE — a scoped report never enters the shared corpus", () => {
  beforeEach(() => {
    vi.mocked(persistScanReport).mockClear();
    vi.mocked(isDbConfigured).mockReturnValue(true);
  });

  it("persist:false skips the durable write entirely", async () => {
    const rep = report();
    const lookup = lookupScopedScan({ parsed, useLLM: true, refSha: BRANCH });
    await cacheAndPersistScan(rep, classifyScanResult(rep, false), {
      tag: "test",
      repo: "octo/mono",
      orgSlug: "public",
      lookup,
      persist: false,
    });
    // Nothing written: the corpus (leaderboard / "latest" / rollups / the regression baseline) is
    // untouched by a branch or single-package reading.
    expect(persistScanReport).not.toHaveBeenCalled();
  });

  it("…but the scoped IN-MEMORY entry is still written (its key can't collide)", async () => {
    const rep = report({ confidence: 0.77 } as Partial<ScanReport>);
    const lookup = lookupScopedScan({ parsed, useLLM: true, refSha: BRANCH, subPath: "packages/api" });
    await cacheAndPersistScan(rep, classifyScanResult(rep, false), {
      tag: "test",
      repo: "octo/mono",
      orgSlug: "public",
      lookup,
      persist: false,
    });
    expect(cacheGet(lookup.cacheKey)?.confidence).toBe(0.77);
  });

  it("an UNSCOPED scan still persists — the default path is unchanged", async () => {
    const rep = report();
    await cacheAndPersistScan(rep, classifyScanResult(rep, false), {
      tag: "test",
      repo: "octo/mono",
      orgSlug: "public",
      lookup: null,
    });
    expect(persistScanReport).toHaveBeenCalledTimes(1);
  });
});
