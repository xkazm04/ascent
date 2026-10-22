// getPublicScanGallery must DEGRADE to its static fallback (null) when the DB is configured but
// UNREACHABLE, instead of 500-ing the public landing page (scan-persistence-history #2). The reads are
// wrapped in dbReadSafe(..., null): a DB-down (PrismaClientInitializationError) returns null so the
// landing page renders its static examples, while a genuine live-DB query error still propagates (a real
// bug must not be masked as "no data"). These pin both directions through the public seam.

import { readFileSync } from "node:fs";
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
// provide the exports scans-read imports at module load, with resolveOrgId under test control.
vi.mock("@/lib/db/scans-shared", () => ({
  DEFAULT_ORG_SLUG: "public",
  canonicalOrgSlug: (slug: string) => slug.trim().toLowerCase(),
  canonicalRepoFullName: (o: string, n: string) => `${o}/${n}`.toLowerCase(),
  parseStringArray: () => [],
  toPersistedRec: vi.fn(),
  resolveOrgId: mockResolveOrgId,
}));

import { SCORING_RUBRIC_VERSION } from "@/lib/maturity/model";
import { galleryCardFrom, getPublicScanGallery } from "./scans-read";

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

// The register has exactly ONE empty-corpus behaviour: this loader returns null and IndexVariant drops
// the section. IndexGallery therefore carries no worded empty state (UAT `RC2-N3` — it had one, and it
// was unreachable). Structural pin, because the branch it guards is a deletion: if the zero-card return
// goes, the component starts rendering a heading and column labels around nothing and needs its empty
// state back.
describe("loadPublicGalleryCards — zero cards is null, so the register has no empty state to render", () => {
  it("returns null the moment it has no cards, rather than an empty board", () => {
    const src = readFileSync("src/lib/db/scans-gallery.ts", "utf8");
    expect(src).toMatch(/if \(cards\.length === 0\) return null;/);
  });

  it("keeps IndexGallery free of a worded empty state", () => {
    const gallerySrc = readFileSync("src/components/landing/prototypes/index/IndexGallery.tsx", "utf8");
    expect(gallerySrc).not.toMatch(/No public scans yet/);
  });
});

// MC-B42 / UAT `TOMAS-L1-11`. The landing register is the SECOND public ranking over the same corpus
// that MC-B18 qualified on /leaderboard, and its cards carried every provenance fact except the ruler.
// The derivation must match `registerEntryFrom`'s exactly: an unstamped scan is UNKNOWN, and unknown is
// never "the same rubric" — the reading `db/outcomes.ts` gives it when refusing to pair across a bump.
describe("galleryCardFrom — the rubric is a provenance qualifier here too", () => {
  const repoRow = (rubricVersion: string | null) =>
    ({
      id: "r1",
      owner: "acme",
      name: "web",
      fullName: "acme/web",
      primaryLanguage: "TypeScript",
      stars: 3,
      scans: [
        {
          headSha: null,
          overallScore: 71,
          level: "L3",
          levelName: "Managed",
          adoptionScore: 68,
          rigorScore: 74,
          posture: "ai-native",
          scannedAt: new Date("2026-08-30T00:00:00.000Z"),
          rubricVersion,
          dimensions: [],
        },
      ],
    }) as never;

  it("carries the rubric the scan was taken under", () => {
    expect(galleryCardFrom(repoRow("r10"))?.rubricVersion).toBe("r10");
  });

  it("marks a scan taken under the CURRENT rubric as current", () => {
    expect(galleryCardFrom(repoRow(SCORING_RUBRIC_VERSION))?.currentRubric).toBe(true);
  });

  it("marks an earlier rubric as NOT current, while still returning a rankable card", () => {
    const card = galleryCardFrom(repoRow("r10"));
    expect(card?.currentRubric).toBe(false);
    // Qualified, not dropped: a stale score is a real rating on an earlier instrument.
    expect(card?.overall).toBe(71);
  });

  it("treats a MISSING rubric as unknown, and unknown is not current", () => {
    const card = galleryCardFrom(repoRow(null));
    expect(card?.rubricVersion).toBeNull();
    expect(card?.currentRubric).toBe(false);
  });
});

// Card about-1: /about's ROI pane recomputes each public repo with the engine's own lens, so the gallery
// card carries the archetype its scan was weighted under. Wire-safe string, passed through unvalidated:
// weightsFor already falls back to the org lens for an unknown id.
describe("galleryCardFrom - archetype rides on the card", () => {
  const withArchetype = (archetype: string) =>
    ({
      id: "r1",
      owner: "acme",
      name: "web",
      fullName: "acme/web",
      primaryLanguage: null,
      stars: 0,
      scans: [
        {
          headSha: null,
          overallScore: 40,
          level: "L2",
          levelName: "Assisted",
          adoptionScore: 40,
          rigorScore: 40,
          posture: "early",
          scannedAt: new Date("2026-10-20T00:00:00.000Z"),
          rubricVersion: SCORING_RUBRIC_VERSION,
          archetype,
          dimensions: [{ dimId: "D2", score: 30 }],
        },
      ],
    }) as never;

  it("carries the scan's archetype", () => {
    expect(galleryCardFrom(withArchetype("team"))?.archetype).toBe("team");
  });

  it("passes an unknown archetype through without throwing", () => {
    expect(galleryCardFrom(withArchetype("library"))?.archetype).toBe("library");
  });
});
