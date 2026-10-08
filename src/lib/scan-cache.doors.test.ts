// The scan cache's persisted tier degrades a failed DB read to a MISS (the caller re-scans) — that
// fallback is by design and must not change. What the door sweep added is that the failure is no
// longer silent: each catch routes through degradeTo, so a thrown read reaches console.warn AND
// telemetry (reportHandledError) naming the read. Pinned here per site so a future refactor back to
// a bare `.catch(() => null)` fails a test instead of quietly going dark again.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveHead } from "@/lib/github/source";
import { getHeadHint, getScanReportByCommit } from "@/lib/db";
import { reportHandledError } from "@/lib/api/respond";
import { lookupCachedScan, lookupPersistedScanByCommit } from "./scan-cache";

vi.mock("@/lib/github/source", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/github/source")>()),
  resolveHead: vi.fn(),
}));

// scan-cache only reads getHeadHint + getScanReportByCommit from the db barrel — mock just those.
vi.mock("@/lib/db", () => ({ getHeadHint: vi.fn(), getScanReportByCommit: vi.fn() }));

vi.mock("@/lib/api/respond", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/respond")>()),
  reportHandledError: vi.fn(),
}));

const mockResolveHead = vi.mocked(resolveHead);
const mockGetHeadHint = vi.mocked(getHeadHint);
const mockGetScanReportByCommit = vi.mocked(getScanReportByCommit);
const mockReportHandledError = vi.mocked(reportHandledError);

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mockResolveHead.mockReset();
  mockGetHeadHint.mockReset().mockResolvedValue(null);
  mockGetScanReportByCommit.mockReset();
  mockReportHandledError.mockReset();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => warn.mockRestore());

describe("lookupCachedScan — persisted tier door (scan-cache.ts getScanReportByCommit catch)", () => {
  it("a thrown persisted read is a cache MISS, and the door names the read", async () => {
    const boom = new Error("db down");
    mockResolveHead.mockResolvedValueOnce({ status: "ok", sha: "sha-door", etag: "e-door" });
    mockGetScanReportByCommit.mockRejectedValueOnce(boom);

    const res = await lookupCachedScan({ parsed: { owner: "octo", repo: "door-tier2" }, useLLM: false, token: undefined });

    // Degraded value unchanged: a miss that still carries the resolved key, so the re-scan is cached.
    expect(res.cached).toBeNull();
    expect(res.source).toBeNull();
    expect(res.headSha).toBe("sha-door");
    expect(res.etag).toBe("e-door");

    // The door: telemetry with the original error + the read's name, and a warning log.
    expect(mockReportHandledError).toHaveBeenCalledTimes(1);
    expect(mockReportHandledError).toHaveBeenCalledWith(boom, {
      message: expect.stringContaining("scan cache: persisted tier (getScanReportByCommit)"),
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("scan cache: persisted tier"), boom);
  });

  it("a successful empty read (no row) is a plain miss — the door stays shut", async () => {
    mockResolveHead.mockResolvedValueOnce({ status: "ok", sha: "sha-quiet", etag: "e-quiet" });
    mockGetScanReportByCommit.mockResolvedValueOnce(null);

    const res = await lookupCachedScan({ parsed: { owner: "octo", repo: "door-quiet" }, useLLM: false, token: undefined });

    expect(res.cached).toBeNull();
    expect(mockReportHandledError).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("lookupPersistedScanByCommit — door (scan-cache.ts getScanReportByCommit catch)", () => {
  it("a thrown read resolves null (the CI gate scans) and reaches the door", async () => {
    const boom = new Error("connection reset");
    mockGetScanReportByCommit.mockRejectedValueOnce(boom);

    await expect(
      lookupPersistedScanByCommit({ owner: "octo", repo: "door-gate", headSha: "abc123", useLLM: false }),
    ).resolves.toBeNull();

    expect(mockReportHandledError).toHaveBeenCalledTimes(1);
    expect(mockReportHandledError).toHaveBeenCalledWith(boom, {
      message: expect.stringContaining("scan cache: lookupPersistedScanByCommit"),
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("scan cache: lookupPersistedScanByCommit"), boom);
  });

  it("a successful empty read stays silent", async () => {
    mockGetScanReportByCommit.mockResolvedValueOnce(null);

    await expect(
      lookupPersistedScanByCommit({ owner: "octo", repo: "door-gate-quiet", headSha: "abc123", useLLM: false }),
    ).resolves.toBeNull();

    expect(mockReportHandledError).not.toHaveBeenCalled();
  });
});
