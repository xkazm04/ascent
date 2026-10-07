// Sweep doors: a badge is chrome, so a failed derivation degrades to zero rather than 500ing the shell
// (the intent) — but each degrade is logged by name and reported.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { report, boom, fail } = vi.hoisted(() => {
  const boom = new Error("db down");
  return { report: vi.fn(), boom, fail: vi.fn(async () => { throw boom; }) };
});
vi.mock("@/lib/api/respond", () => ({ reportHandledError: report }));
vi.mock("@/lib/db", () => ({
  getOrgPassportBlockers: fail, getOrgTeamRollup: fail, getContributorInsights: fail,
  resolvedKeys: fail, getOrgNavCounts: vi.fn(async () => ({ followups: 0, members: 1 })),
}));
vi.mock("@/lib/db/practice-adoption", () => ({ listPracticeAdoptions: fail }));
vi.mock("@/lib/org/security", () => ({ buildSecurityOverview: fail }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn }));

import { getOrgFindingCounts } from "./nav-counts";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("nav-count degrades", () => {
  it("answers zero badges, warns naming each failed source, and reports each", async () => {
    const counts = await getOrgFindingCounts("acme");
    expect(counts).toEqual({ security: 0, teams: 0, passports: 0, contributors: 0, practices: 0 });
    const warned = vi.mocked(console.warn).mock.calls.map((c) => String(c[0])).join("\n");
    for (const read of ["security findings", "passport blockers", "team rollup", "contributor insights", "practice adoptions", "resolved findings"]) {
      expect(warned).toContain(`nav ${read} failed`);
    }
    expect(report).toHaveBeenCalledTimes(6);
  });
});
