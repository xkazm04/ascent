// getPublicScanGallery must DEGRADE to its static fallback (null) when the DB is configured but
// UNREACHABLE, instead of 500-ing the public landing page (scan-persistence-history #2). The reads are
// wrapped in dbReadSafe(..., null): a DB-down (PrismaClientInitializationError) returns null so the
// landing page renders its static examples, while a genuine live-DB query error still propagates (a real
// bug must not be masked as "no data"). These pin both directions through the public seam.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockIsDbConfigured, mockResolveOrgId } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(() => true),
  mockResolveOrgId: vi.fn(),
}));

// The mock factory is hoisted, so its dbReadSafe stand-in must be defined INLINE (no top-level closure).
// It faithfully mimics the real dbReadSafe: run fn, and on a DB-UNREACHABLE throw return the fallback; any
// other error propagates. (The real error classifier is unit-tested in client.test.ts; here we only need
// dbReadSafe to catch-and-degrade the unreachable case so the wrapping in getPublicScanGallery shows.)
vi.mock("@/lib/db/client", () => ({
  isDbConfigured: mockIsDbConfigured,
  getPrisma: vi.fn(() => {
    throw new Error("getPrisma should not be reached once resolveOrgId throws");
  }),
  dbReadSafe: async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      const name = (err as { name?: string })?.name;
      const msg = String((err as { message?: string })?.message ?? err).toLowerCase();
      if (
        name === "PrismaClientInitializationError" ||
        msg.includes("reach database server") ||
        msg.includes("econnrefused")
      ) {
        return fallback;
      }
      throw err;
    }
  },
}));

vi.mock("@/lib/db/mode", () => ({ getDbMode: () => "static" }));

// getPublicScanGallery resolves the public org id through scans-shared before touching the cached corpus;
// provide the five exports scans-read imports at module load, with resolveOrgId under test control.
vi.mock("@/lib/db/scans-shared", () => ({
  DEFAULT_ORG_SLUG: "public",
  canonicalRepoFullName: (o: string, n: string) => `${o}/${n}`.toLowerCase(),
  parseStringArray: () => [],
  toPersistedRec: vi.fn(),
  resolveOrgId: mockResolveOrgId,
}));

import { getPublicScanGallery } from "./scans-read";

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
});

describe("getPublicScanGallery — DB-down degrades to the static fallback", () => {
  it("returns null (not a throw) when a DB-unreachable error is raised", async () => {
    // The first DB touch (resolveOrgId) throws the exact connect-time error a DB-down raises. Without the
    // dbReadSafe wrapper this bubbled out and 500'd the force-dynamic landing page.
    const initErr = Object.assign(new Error("Can't reach database server at localhost:5432"), {
      name: "PrismaClientInitializationError",
    });
    mockResolveOrgId.mockRejectedValue(initErr);

    await expect(getPublicScanGallery()).resolves.toBeNull();
  });

  it("propagates a genuine live-DB query error (does NOT mask a real bug as 'no data')", async () => {
    const bug = new Error("column does not exist");
    mockResolveOrgId.mockRejectedValue(bug);

    await expect(getPublicScanGallery()).rejects.toBe(bug);
  });

  it("still short-circuits to null when persistence is disabled (no DB access at all)", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    await expect(getPublicScanGallery()).resolves.toBeNull();
    expect(mockResolveOrgId).not.toHaveBeenCalled();
  });
});
