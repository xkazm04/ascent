// Sweep doors: the union read degrades to an empty ledger on a failed source (the briefing's loop line
// is optional) but each failure is logged by name and reported.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { report } = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock("@/lib/api/respond", () => ({ reportHandledError: report }));
const boom = new Error("db down");
vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  getPrisma: () => ({
    improvementPr: {
      findMany: async () => { throw boom; },
      upsert: async () => { throw boom; },
    },
  }),
}));
const getOrgBySlug = vi.fn();
vi.mock("@/lib/db/org-shared", () => ({ getOrgBySlug: (s: string) => getOrgBySlug(s) }));
vi.mock("@/lib/db/loop-runs-read", () => ({ listLaneImpactInputs: async () => { throw boom; } }));

import { getImprovementEvents, recordLoopPr } from "./improvement-events";

const warned = () => vi.mocked(console.warn).mock.calls.map((c) => String(c[0])).join("\n");

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("improvement-events degrades", () => {
  it("answers an empty list and names the failed org lookup", async () => {
    getOrgBySlug.mockRejectedValue(boom);
    expect(await getImprovementEvents("acme")).toEqual([]);
    expect(warned()).toContain("improvement events org lookup failed");
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("answers an empty list and names both failed sources", async () => {
    getOrgBySlug.mockResolvedValue({ id: "o1" });
    expect(await getImprovementEvents("acme")).toEqual([]);
    expect(warned()).toContain("improvement events merged PRs failed");
    expect(warned()).toContain("improvement events lane impact failed");
  });

  it("answers false and names a failed loop-PR record", async () => {
    const ok = await recordLoopPr({ orgId: "o", laneId: "l", repoFullName: "a/b", dimId: "D1", prNumber: 1, prUrl: "u", beforeScanId: null, openedBy: null });
    expect(ok).toBe(false);
    expect(warned()).toContain("loop PR record failed");
  });
});
