// Integration test for the conditional head-hint reuse (scan-and-decide idea d19f7836): the
// badge/gate surfaces resolve the head sha through resolveHeadWithHint, which must send the prior
// ETag (If-None-Match) so an unchanged repo answers a free 304 instead of burning a rate-limit
// unit per request. resolveHead is mocked; the in-memory hint store (cache.ts) is the real thing.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveHead } from "@/lib/github/source";
import { getHeadHint, getScanReportByCommit } from "@/lib/db";
import {
  lookupCachedScan,
  lookupPersistedScanByCommit,
  persistedMatchesActiveIdentity,
  resolveHeadWithHint,
} from "./scan-cache";
import { SCORING_RUBRIC_VERSION } from "@/lib/maturity/model";
import type { ScanReport } from "@/lib/types";

vi.mock("@/lib/github/source", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/github/source")>()),
  resolveHead: vi.fn(),
}));

// scan-cache only reads getHeadHint + getScanReportByCommit from the db barrel — mock just those.
vi.mock("@/lib/db", () => ({ getHeadHint: vi.fn(), getScanReportByCommit: vi.fn() }));

const mockResolveHead = vi.mocked(resolveHead);
const mockGetHeadHint = vi.mocked(getHeadHint);
const mockGetScanReportByCommit = vi.mocked(getScanReportByCommit);

/** Minimal persisted report — only the fields the identity guard + freshness gate read. */
const fakeReport = (
  engine: { provider: string; model: string; rubricVersion?: string },
  scannedAt = new Date().toISOString(),
) => ({ engine, scannedAt }) as unknown as ScanReport;

describe("resolveHeadWithHint — conditional head-hint reuse (#7)", () => {
  beforeEach(() => mockResolveHead.mockReset());

  it("stores the hint on a fresh 200 and returns the head sha", async () => {
    mockResolveHead.mockResolvedValueOnce({ status: "ok", sha: "sha1", etag: "etag1" });
    const sha = await resolveHeadWithHint({ owner: "octo", repo: "hint-200" }, "tok");
    expect(sha).toBe("sha1");
    // First lookup has no prior ETag.
    expect(mockResolveHead).toHaveBeenNthCalledWith(1, { owner: "octo", repo: "hint-200" }, { token: "tok", etag: null });
  });

  it("reuses the stored ETag (If-None-Match) on the next lookup and returns the cached sha on a 304", async () => {
    mockResolveHead
      .mockResolvedValueOnce({ status: "ok", sha: "sha1", etag: "etag1" })
      .mockResolvedValueOnce({ status: "unmodified" });
    const first = await resolveHeadWithHint({ owner: "octo", repo: "hint-304" }, "tok");
    const second = await resolveHeadWithHint({ owner: "octo", repo: "hint-304" }, "tok");
    expect(first).toBe("sha1");
    expect(second).toBe("sha1"); // 304 → reuse the prior sha (the free re-validation)
    // The whole point of #7: the SECOND call sends the ETag it learned from the first.
    expect(mockResolveHead).toHaveBeenNthCalledWith(2, { owner: "octo", repo: "hint-304" }, { token: "tok", etag: "etag1" });
  });

  it("refreshes the hint when GitHub returns a new head (200 with a new sha/etag)", async () => {
    mockResolveHead
      .mockResolvedValueOnce({ status: "ok", sha: "old", etag: "e-old" })
      .mockResolvedValueOnce({ status: "ok", sha: "new", etag: "e-new" });
    await resolveHeadWithHint({ owner: "octo", repo: "hint-refresh" }, "tok"); // stores {e-old, old}
    const sha = await resolveHeadWithHint({ owner: "octo", repo: "hint-refresh" }, "tok");
    expect(sha).toBe("new");
    expect(mockResolveHead).toHaveBeenNthCalledWith(2, { owner: "octo", repo: "hint-refresh" }, { token: "tok", etag: "e-old" });
  });

  it("returns null on a failed head lookup so the caller falls back to a SHA-less key", async () => {
    mockResolveHead.mockResolvedValueOnce({ status: "error" });
    expect(await resolveHeadWithHint({ owner: "octo", repo: "hint-error" }, "tok")).toBeNull();
  });
});

// DB-tier identity guard (scan-pipeline-ingestion #1): the persistent cache keys only on (repo, sha),
// so — exactly like the in-memory key before it learned the scoring identity — it would serve an OLD
// provider/model's score as current after a swap (bounded only by the 7-day age gate). The persisted
// hit must now also match the CURRENT {provider, model}, or it's a miss and re-scans.
describe("persistedMatchesActiveIdentity — reproduce-under-current-config guard", () => {
  it("matches when the persisted engine equals the active identity (mock mode)", () => {
    expect(persistedMatchesActiveIdentity(fakeReport({ provider: "mock", model: "deterministic-rubric" }), false)).toBe(
      true,
    );
  });

  it("rejects a persisted report from a DIFFERENT provider/model (the swap case)", () => {
    // Active mock identity vs a persisted gemini scan → not reproducible now → miss.
    expect(persistedMatchesActiveIdentity(fakeReport({ provider: "gemini", model: "gemini-3-flash" }), false)).toBe(
      false,
    );
  });

  it("is CONSERVATIVE: a blank/legacy engine stamp is served (no re-scan storm)", () => {
    expect(persistedMatchesActiveIdentity(fakeReport({ provider: "", model: "" }), false)).toBe(true);
  });
});

// Rubric self-invalidation (scan-pipeline Direction 3): the Scan row now persists rubricVersion, so a
// SCORING_RUBRIC_VERSION bump busts the DB tier PER-ROW instead of waiting out the 7-day age gate. Same
// CONSERVATIVE contract as provider/model: a POSITIVE mismatch (row HAS a version, and it differs) is a
// miss; a legacy/null version keeps today's behavior (served, age-gated).
describe("persistedMatchesActiveIdentity — rubric-version self-invalidation", () => {
  it("ACCEPTS a row whose persisted rubricVersion equals the active SCORING_RUBRIC_VERSION", () => {
    expect(
      persistedMatchesActiveIdentity(
        fakeReport({ provider: "mock", model: "deterministic-rubric", rubricVersion: SCORING_RUBRIC_VERSION }),
        false,
      ),
    ).toBe(true);
  });

  it("REJECTS a POSITIVE mismatch — provider/model still match but the rubric was bumped", () => {
    // Isolate the rubric lever: identical provider+model, only the persisted rubric differs → miss/re-scan.
    expect(
      persistedMatchesActiveIdentity(
        fakeReport({ provider: "mock", model: "deterministic-rubric", rubricVersion: `${SCORING_RUBRIC_VERSION}-stale` }),
        false,
      ),
    ).toBe(false);
  });

  it("ACCEPTS a legacy row with NO persisted rubricVersion (served, age-gated — no re-scan storm)", () => {
    expect(
      persistedMatchesActiveIdentity(fakeReport({ provider: "mock", model: "deterministic-rubric" }), false),
    ).toBe(true);
  });
});

describe("lookupCachedScan — tier-2 (DB) honors the identity guard", () => {
  beforeEach(() => {
    mockResolveHead.mockReset();
    mockGetHeadHint.mockReset().mockResolvedValue(null);
    mockGetScanReportByCommit.mockReset();
  });

  it("serves a fresh persisted report whose engine matches the current config", async () => {
    mockResolveHead.mockResolvedValueOnce({ status: "ok", sha: "sha-match", etag: "e1" });
    mockGetScanReportByCommit.mockResolvedValueOnce(fakeReport({ provider: "mock", model: "deterministic-rubric" }));

    const res = await lookupCachedScan({ parsed: { owner: "octo", repo: "db-match" }, useLLM: false });
    expect(res.source).toBe("db");
    expect(res.cached).not.toBeNull();
  });

  it("treats a fresh persisted report from a DIFFERENT provider/model as a MISS (re-scan)", async () => {
    mockResolveHead.mockResolvedValueOnce({ status: "ok", sha: "sha-swap", etag: "e1" });
    mockGetScanReportByCommit.mockResolvedValueOnce(fakeReport({ provider: "gemini", model: "gemini-3-flash" }));

    const res = await lookupCachedScan({ parsed: { owner: "octo", repo: "db-swap" }, useLLM: false });
    expect(res.cached).toBeNull(); // identity mismatch → don't serve the stale-config score
    expect(res.source).toBeNull();
    expect(res.headSha).toBe("sha-swap"); // still resolved the sha so the re-scan is cached
  });
});

// The CI gate's warm path (ci-gate Direction 1): the gate endpoint holds an EXACT sha (?ref=<pr head>
// or a head it resolved) and, before this, had only a per-instance memory cache — so every cold
// serverless instance re-ingested the whole repo even though the App webhook had just scanned that
// same sha. lookupPersistedScanByCommit is tier 2 without the head resolve, and it must carry the
// SAME three guards as lookupCachedScan's persistent tier, or the two tiers could disagree.
describe("lookupPersistedScanByCommit — DB tier for a known commit", () => {
  beforeEach(() => {
    mockGetScanReportByCommit.mockReset();
  });

  it("HIT: serves a fresh, identity-matching row pinned to the requested commit (no ingest needed)", async () => {
    mockGetScanReportByCommit.mockResolvedValueOnce(fakeReport({ provider: "mock", model: "deterministic-rubric" }));

    const res = await lookupPersistedScanByCommit({
      owner: "octo",
      repo: "warm",
      headSha: "abc123",
      useLLM: false,
    });

    expect(res).not.toBeNull();
    // Keyed on the EXACT sha + the shared PUBLIC org (the anonymous read surface, which refuses to
    // serve a private repo's report) — never an unpinned "latest scan for this repo" read.
    expect(mockGetScanReportByCommit).toHaveBeenCalledWith("octo", "warm", { headSha: "abc123", orgSlug: "public" });
  });

  it("MISS: no persisted row for this commit → null (caller ingests)", async () => {
    mockGetScanReportByCommit.mockResolvedValueOnce(null);
    expect(
      await lookupPersistedScanByCommit({ owner: "octo", repo: "cold", headSha: "abc123", useLLM: false }),
    ).toBeNull();
  });

  it("IDENTITY MISMATCH: a row from a different provider/model is a miss (re-scan, never a stale-config score)", async () => {
    mockGetScanReportByCommit.mockResolvedValueOnce(fakeReport({ provider: "gemini", model: "gemini-3-flash" }));
    expect(
      await lookupPersistedScanByCommit({ owner: "octo", repo: "swap", headSha: "abc123", useLLM: false }),
    ).toBeNull();
  });

  it("RUBRIC MISMATCH: a row scored under an older SCORING_RUBRIC_VERSION is a miss", async () => {
    mockGetScanReportByCommit.mockResolvedValueOnce(
      fakeReport({ provider: "mock", model: "deterministic-rubric", rubricVersion: `${SCORING_RUBRIC_VERSION}-stale` }),
    );
    expect(
      await lookupPersistedScanByCommit({ owner: "octo", repo: "rubric", headSha: "abc123", useLLM: false }),
    ).toBeNull();
  });

  it("MODE MISMATCH: an LLM-scored row cannot answer a DEFAULT (mock) gate — the deterministic verdict stays deterministic", async () => {
    // The gate's ?mock default demands the deterministic rubric. Serving the LLM row would make the
    // verdict stochastic (a PR flipping pass↔fail with identical code), the same class of bug the
    // in-memory tier's per-mode key already prevents.
    mockGetScanReportByCommit.mockResolvedValueOnce(fakeReport({ provider: "claude-cli", model: "claude-opus" }));
    expect(
      await lookupPersistedScanByCommit({ owner: "octo", repo: "mode", headSha: "abc123", useLLM: false }),
    ).toBeNull();
  });

  it("STALE: a row older than the max cache age is a miss (weekly-refresh allowance)", async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 86_400_000).toISOString();
    mockGetScanReportByCommit.mockResolvedValueOnce(
      fakeReport({ provider: "mock", model: "deterministic-rubric" }, eightDaysAgo),
    );
    expect(
      await lookupPersistedScanByCommit({ owner: "octo", repo: "stale", headSha: "abc123", useLLM: false }),
    ).toBeNull();
  });

  it("a DB error degrades to a miss — never an exception into the CI gate path", async () => {
    mockGetScanReportByCommit.mockRejectedValueOnce(new Error("db down"));
    await expect(
      lookupPersistedScanByCommit({ owner: "octo", repo: "down", headSha: "abc123", useLLM: false }),
    ).resolves.toBeNull();
  });
});
