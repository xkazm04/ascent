// The org rail's badge derivation runs in the SHELL, so whatever it calls is charged to EVERY dashboard
// tab — including Audit, which reads nothing else from the fleet (the module header records that path
// measured at 144ms → 1.5s once fleet rollups landed in it). The `passports` badge reads exactly one
// thing: each repo's readiness blockers. It used to get them from the full unscoped getOrgRollup.
//
// This pins the outcome AND the shape of the fix, because both are invisible from the UI:
//   - getOrgRollup is never called from this path (reintroducing it would silently re-tax every tab);
//   - the badge numbers are unchanged — same findings, minus the ones a human already resolved.

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  getOrgRollup: vi.fn(async () => null),
  getOrgPassportBlockers: vi.fn(async () => [] as { fullName: string; blockers: string[] }[]),
  getOrgTeamRollup: vi.fn(async () => null),
  getContributorInsights: vi.fn(async () => null),
  resolvedKeys: vi.fn(async () => new Map<string, Set<string>>()),
  getOrgNavCounts: vi.fn(async () => ({ followups: 1, members: 3 })),
  buildSecurityOverview: vi.fn(async () => null),
}));

vi.mock("@/lib/db", () => ({
  getOrgRollup: h.getOrgRollup,
  getOrgPassportBlockers: h.getOrgPassportBlockers,
  getOrgTeamRollup: h.getOrgTeamRollup,
  getContributorInsights: h.getContributorInsights,
  resolvedKeys: h.resolvedKeys,
  getOrgNavCounts: h.getOrgNavCounts,
}));
vi.mock("@/lib/org/security", () => ({ buildSecurityOverview: h.buildSecurityOverview }));
// `unstable_cache` would memoize the derivation across cases in this file and hide the call counts.
vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn }));

import { getNavCounts, getOrgFindingCounts } from "@/lib/org/nav-counts";

describe("nav-count finding derivation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("never calls the full fleet rollup — the badge is not worth a rollup on every tab", async () => {
    await getOrgFindingCounts("acme");
    expect(h.getOrgRollup).not.toHaveBeenCalled();
    expect(h.getOrgPassportBlockers).toHaveBeenCalledWith("acme");
  });

  it("badges one passport finding per distinct blocker, across both axes", async () => {
    h.getOrgPassportBlockers.mockResolvedValueOnce([
      { fullName: "acme/a", blockers: ["no CI", "no runbook"] },
      { fullName: "acme/b", blockers: ["no CI"] },
    ]);
    expect((await getOrgFindingCounts("acme")).passports).toBe(3);
  });

  it("de-dupes a blocker listed on BOTH readiness axes of the same repo", async () => {
    h.getOrgPassportBlockers.mockResolvedValueOnce([{ fullName: "acme/a", blockers: ["no CI", "no CI"] }]);
    expect((await getOrgFindingCounts("acme")).passports).toBe(1);
  });

  it("subtracts findings a human has already resolved, fresh on every request", async () => {
    const repos = [{ fullName: "acme/a", blockers: ["no CI", "no runbook"] }];
    h.getOrgPassportBlockers.mockResolvedValueOnce(repos).mockResolvedValueOnce(repos);
    const all = await getOrgFindingCounts("acme");
    expect(all.passports).toBe(2);

    // Resolve one of the two by its itemKey, exactly as an OrgDecision would.
    const { passportFindings } = await import("@/lib/org/findings");
    const keys = passportFindings([{ fullName: "acme/a", blockers: ["no CI"] }]).map((f) => f.itemKey);
    h.resolvedKeys.mockResolvedValueOnce(new Map([["passports", new Set(keys)]]));
    expect((await getOrgFindingCounts("acme")).passports).toBe(1);
  });

  it("degrades to unbadged rather than 500-ing the shell when the blocker read fails", async () => {
    h.getOrgPassportBlockers.mockRejectedValueOnce(new Error("db down"));
    expect((await getOrgFindingCounts("acme")).passports).toBe(0);
  });

  it("merges the stateful counts with the derived ones", async () => {
    expect(await getNavCounts("acme")).toEqual({
      followups: 1,
      members: 3,
      security: 0,
      teams: 0,
      passports: 0,
      contributors: 0,
    });
  });
});
