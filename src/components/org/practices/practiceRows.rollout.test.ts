// G7-20. The fleet rollup is the number a leader reads, so its honesty rules are the test:
//   * a library nobody has applied renders NO strip rather than a row of confident zeros;
//   * playbook lift is WEIGHTED by its sample, so a 1-repo playbook can't outvote a 12-repo one;
//   * playbook lift and practice-PR lift stay SEPARATE — they are measured on different bases;
//   * a null lift means "not measured yet", never "no effect", and must not drag an average to zero.

import { describe, it, expect } from "vitest";
import { rolloutIsMeaningful, summarizeRollout, type PracticeRow } from "./practiceRows";

function authored(id: string, adoption: { repos: number; appliedRepos: string[]; lift: number | null; measured: number }): PracticeRow {
  return {
    key: `authored:${id}`,
    source: "authored",
    id,
    label: id,
    dimId: "D2",
    what: "",
    adoptionPct: null,
    adoptionLabel: "",
    reachLabel: null,
    opportunity: 0,
    authored: {
      playbook: {
        id,
        title: id,
        dimId: "D2",
        summary: "",
        steps: [],
        createdBy: null,
        createdAt: "",
        version: 1,
        updatedAt: "",
      },
      adoption,
    },
  };
}

function mined(id: string, rollout?: { open: number; merged: number; lift: number | null }): PracticeRow {
  return {
    key: `mined:${id}`,
    source: "mined",
    id,
    label: id,
    dimId: "D2",
    what: "",
    adoptionPct: null,
    adoptionLabel: "",
    reachLabel: null,
    opportunity: 0,
    ...(rollout ? { rollout } : {}),
  };
}

describe("summarizeRollout", () => {
  it("reports nothing meaningful for a library that has never been applied", () => {
    const r = summarizeRollout([authored("a", { repos: 0, appliedRepos: [], lift: null, measured: 0 }), mined("m")]);
    expect(rolloutIsMeaningful(r)).toBe(false);
    expect(r).toMatchObject({ adoptingRepos: 0, prsOpen: 0, prsMerged: 0, playbookLift: null, practiceLift: null });
  });

  it("counts DISTINCT adopting repos across playbooks (a repo adopting two isn't two repos)", () => {
    const r = summarizeRollout([
      authored("a", { repos: 2, appliedRepos: ["acme/web", "acme/api"], lift: null, measured: 0 }),
      authored("b", { repos: 1, appliedRepos: ["acme/web"], lift: null, measured: 0 }),
    ]);
    expect(r.adoptingRepos).toBe(2);
    expect(r.playbooksAdopted).toBe(2);
  });

  it("weights playbook lift by its sample — a 1-repo +20 can't outvote a 9-repo +0", () => {
    const r = summarizeRollout([
      authored("small", { repos: 1, appliedRepos: ["acme/a"], lift: 20, measured: 1 }),
      authored("big", { repos: 9, appliedRepos: ["acme/b"], lift: 0, measured: 9 }),
    ]);
    // Unweighted this would be +10; pooled it is +2.
    expect(r.playbookLift).toBe(2);
    expect(r.playbookMeasured).toBe(10);
  });

  it("treats a null lift as UNMEASURED — it never pulls the average toward zero", () => {
    const r = summarizeRollout([
      authored("measured", { repos: 1, appliedRepos: ["acme/a"], lift: 8, measured: 2 }),
      authored("pending", { repos: 3, appliedRepos: ["acme/b"], lift: null, measured: 0 }),
    ]);
    expect(r.playbookLift).toBe(8);
    expect(r.playbookMeasured).toBe(2);
    expect(r.adoptingRepos).toBe(2);
  });

  it("sums starter PRs and keeps the practice-PR lift separate from the playbook lift", () => {
    const r = summarizeRollout([
      authored("a", { repos: 1, appliedRepos: ["acme/a"], lift: 10, measured: 1 }),
      mined("m1", { open: 2, merged: 3, lift: 4 }),
      mined("m2", { open: 1, merged: 1, lift: 6 }),
      mined("m3", { open: 0, merged: 1, lift: null }), // merged but awaiting rescan
    ]);
    expect(r.prsOpen).toBe(3);
    expect(r.prsMerged).toBe(5);
    expect(r.practiceLift).toBe(5); // (4 + 6) / 2 — the unmeasured one is excluded
    expect(r.practiceLiftSources).toBe(2);
    expect(r.playbookLift).toBe(10); // untouched by the practice figures
    expect(rolloutIsMeaningful(r)).toBe(true);
  });
});
