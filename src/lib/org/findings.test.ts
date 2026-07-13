// Unit tests for derived-finding promotion. The property everything else depends on is KEY STABILITY:
// a decision is stored against `itemKey`, so if a key rotates across scans the decision orphans and a
// dismissed finding silently returns to the rail's badge. These tests pin exactly that — keys ride
// stable ids where they exist, survive cosmetic text churn where they don't, and change when the
// finding genuinely changes.

import { describe, expect, it } from "vitest";
import {
  blockerKey,
  contributorFindings,
  fnv1a,
  isFindingModule,
  passportFindings,
  securityFindings,
  teamsFindings,
} from "@/lib/org/findings";

describe("securityFindings", () => {
  const row = (checks: { id: string; name: string; score: number | null }[]) => ({
    fullName: "acme/api",
    checks: checks.map((c) => ({ ...c, risk: "risk copy", detail: "detail copy" })),
  });

  it("emits one finding per failing check, keyed on the check's stable id", () => {
    const found = securityFindings([row([{ id: "branch-protection", name: "Branch protection", score: 2 }])]);
    expect(found).toHaveLength(1);
    expect(found[0]!.itemKey).toBe("acme/api::branch-protection");
    expect(found[0]!.module).toBe("security");
  });

  it("ignores passing checks and not-applicable (null) checks", () => {
    const found = securityFindings([
      row([
        { id: "a", name: "Passing", score: 7 },
        { id: "b", name: "Strong", score: 10 },
        { id: "c", name: "N/A", score: null },
        { id: "d", name: "Failing", score: 6 },
      ]),
    ]);
    expect(found.map((f) => f.itemKey)).toEqual(["acme/api::d"]);
  });

  it("keeps the key stable when the risk/detail copy is reworded", () => {
    const a = securityFindings([{ fullName: "acme/api", checks: [{ id: "sig", name: "Signing", score: 1, risk: "old", detail: "old" }] }]);
    const b = securityFindings([{ fullName: "acme/api", checks: [{ id: "sig", name: "Signing", score: 1, risk: "NEW WORDING", detail: "also new" }] }]);
    expect(a[0]!.itemKey).toBe(b[0]!.itemKey);
  });
});

describe("teamsFindings", () => {
  it("keys on the repo fullName — the repo is the identity", () => {
    const found = teamsFindings([{ fullName: "acme/web", overall: 40 }]);
    expect(found[0]!.itemKey).toBe("acme/web");
    expect(found[0]!.module).toBe("teams");
  });
});

describe("passportFindings", () => {
  it("hashes the blocker text, scoped to the repo", () => {
    const found = passportFindings([{ fullName: "acme/api", blockers: ["No CI pipeline"] }]);
    expect(found[0]!.itemKey).toBe(blockerKey("acme/api", "No CI pipeline"));
    expect(found[0]!.itemKey.startsWith("acme/api::")).toBe(true);
  });

  it("survives whitespace and case churn in the blocker text", () => {
    expect(blockerKey("acme/api", "No CI pipeline")).toBe(blockerKey("acme/api", "  no   ci PIPELINE  "));
  });

  it("gives the same blocker on different repos different keys", () => {
    expect(blockerKey("acme/api", "No CI")).not.toBe(blockerKey("acme/web", "No CI"));
  });

  it("rotates the key when the blocker is materially reworded (a new finding deserves a fresh look)", () => {
    expect(blockerKey("acme/api", "No CI pipeline")).not.toBe(blockerKey("acme/api", "No CD pipeline"));
  });

  it("de-duplicates a blocker listed on both readiness axes", () => {
    const found = passportFindings([{ fullName: "acme/api", blockers: ["No CI", "no ci", "No tests"] }]);
    expect(found).toHaveLength(2);
  });

  it("drops blank blockers", () => {
    expect(passportFindings([{ fullName: "acme/api", blockers: ["", "   "] }])).toEqual([]);
  });
});

describe("contributorFindings", () => {
  it("emits only solo-maintained repos, keyed on the repo", () => {
    const found = contributorFindings([
      { fullName: "acme/api", soloMaintainer: true, contributors: 1, topShare: 100 },
      { fullName: "acme/web", soloMaintainer: false, contributors: 9, topShare: 30 },
    ]);
    expect(found.map((f) => f.itemKey)).toEqual(["acme/api"]);
  });

  it("distinguishes a single contributor from a dominant one in the detail copy", () => {
    const [solo] = contributorFindings([{ fullName: "a/b", soloMaintainer: true, contributors: 1, topShare: 100 }]);
    const [dominant] = contributorFindings([{ fullName: "a/b", soloMaintainer: true, contributors: 5, topShare: 84.4 }]);
    expect(solo!.detail).toContain("single contributor");
    expect(dominant!.detail).toContain("84%");
  });
});

describe("fnv1a", () => {
  it("is deterministic and fixed-width", () => {
    expect(fnv1a("hello")).toBe(fnv1a("hello"));
    expect(fnv1a("hello")).toHaveLength(8);
    expect(fnv1a("hello")).not.toBe(fnv1a("hellp"));
  });
});

describe("isFindingModule", () => {
  it("accepts the four promoted modules and rejects anything else", () => {
    expect(["security", "teams", "passports", "contributors"].every(isFindingModule)).toBe(true);
    expect(isFindingModule("backlog")).toBe(false);
    expect(isFindingModule(null)).toBe(false);
  });
});
