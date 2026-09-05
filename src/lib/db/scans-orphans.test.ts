// getOrphanedTrackedRecommendations — the DERIVED read behind "N tracked items couldn't be carried".
//
// The pure decision lives in compare.ts (findOrphanedTracked, covered there). What this pins is the
// plumbing that could silently break the feature or leak: which two scans are compared, the
// public-org privacy guard, and the "only one scan ⇒ nothing was ever carried ⇒ no alarm" corner.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(() => true),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: mockIsDbConfigured,
  getPrisma: mockGetPrisma,
}));

vi.mock("@/lib/db/scans-shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./scans-shared")>()),
  resolveOrgId: vi.fn(async (slug: string) => (slug === "nobody" ? null : `org_${slug}`)),
}));

const { getOrphanedTrackedRecommendations } = await import("./scans-recommendations");

interface Rec {
  dimId: string;
  title: string;
  status: string;
  assigneeLogin: string | null;
  targetDate: Date | null;
}
const r = (over: Partial<Rec> & { title: string }): Rec => ({
  dimId: "D3",
  status: "open",
  assigneeLogin: null,
  targetDate: null,
  ...over,
});

let repo: { id: string; isPrivate: boolean } | null;
let scans: { id: string; recommendations: Rec[] }[];
const findMany = vi.fn(async () => scans);

beforeEach(() => {
  repo = { id: "repo_1", isPrivate: false };
  scans = [];
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
  mockGetPrisma.mockReturnValue({
    repository: { findUnique: vi.fn(async () => repo) },
    scan: { findMany },
  });
});

/** Two scans in which BOTH D3 gaps were reworded — the case the matcher refuses to guess at. */
function reworded() {
  scans = [
    {
      id: "scan_new",
      recommendations: [r({ title: "Pipeline runs tests without gating" }), r({ title: "Coverage is never measured" })],
    },
    {
      id: "scan_prev",
      recommendations: [
        r({ title: "CI never gates the tests", status: "in_progress", assigneeLogin: "octocat" }),
        r({ title: "No coverage tracking", status: "done", targetDate: new Date("2026-09-01T00:00:00Z") }),
      ],
    },
  ];
}

describe("getOrphanedTrackedRecommendations", () => {
  it("compares the two most recent scans and reports what couldn't be carried", async () => {
    reworded();
    const out = await getOrphanedTrackedRecommendations("acme", "web", { orgSlug: "acme" });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2 }));
    expect(out.map((o) => o.title)).toEqual(["CI never gates the tests", "No coverage tracking"]);
    // The date is normalized to the YYYY-MM-DD the PATCH contract accepts, so a re-link round-trips.
    expect(out[1]).toMatchObject({ status: "done", targetDate: "2026-09-01", fromScanId: "scan_prev" });
  });

  it("reports nothing when there is only one scan — nothing was ever carried", async () => {
    reworded();
    scans = [scans[0]!];
    expect(await getOrphanedTrackedRecommendations("acme", "web", { orgSlug: "acme" })).toEqual([]);
  });

  it("never serves a PRIVATE repo's assignees/dates out of the shared public org", async () => {
    reworded();
    repo = { id: "repo_1", isPrivate: true };
    expect(await getOrphanedTrackedRecommendations("acme", "web", { orgSlug: "public" })).toEqual([]);
    // …but the owning org still sees its own repo.
    expect(await getOrphanedTrackedRecommendations("acme", "web", { orgSlug: "acme" })).toHaveLength(2);
  });

  it("degrades to empty when persistence is off, the org is unknown, or the repo isn't stored", async () => {
    reworded();
    mockIsDbConfigured.mockReturnValue(false);
    expect(await getOrphanedTrackedRecommendations("acme", "web", { orgSlug: "acme" })).toEqual([]);
    mockIsDbConfigured.mockReturnValue(true);
    expect(await getOrphanedTrackedRecommendations("acme", "web", { orgSlug: "nobody" })).toEqual([]);
    repo = null;
    expect(await getOrphanedTrackedRecommendations("acme", "web", { orgSlug: "acme" })).toEqual([]);
  });
});
