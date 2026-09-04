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
  practiceFindings,
  passportFindingKey,
  passportFindingKeys,
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

// Passport 0.4.0 minted `findings[].id` per CAUSE precisely so rewording a blocker stops orphaning the
// judgment recorded against it — the decline overlay already joins on it. These pin the org-decision
// half onto the SAME identity, so the two subsystems stop holding two names for one finding.
describe("passportFindingKey", () => {
  const obs = { id: "prod.zero-observability", code: "zero-observability", text: "Zero observability: no error tracking." };

  it("keys on the minted id, so a reworded blocker keeps its decision", () => {
    const reworded = { ...obs, text: "This service emits no telemetry of any kind." };
    expect(passportFindingKey("acme/api", reworded)).toBe(passportFindingKey("acme/api", obs));
    expect(passportFindingKey("acme/api", obs)).toBe("acme/api::prod.zero-observability");
  });

  it("separates two different causes that happen to read identically", () => {
    const a = { id: "auto.no-manifest", code: "no-manifest", text: "The repo has no agent contract." };
    const b = { id: "auto.no-context-graph", code: "no-context-graph", text: "The repo has no agent contract." };
    expect(passportFindingKey("acme/api", a)).not.toBe(passportFindingKey("acme/api", b));
  });

  it("scopes the id to the repo, like every other key here", () => {
    expect(passportFindingKey("acme/api", obs)).not.toBe(passportFindingKey("acme/web", obs));
  });

  it("falls back to the legacy prose key when the finding has no id at all", () => {
    expect(passportFindingKey("acme/api", { text: "No CI pipeline" })).toBe(blockerKey("acme/api", "No CI pipeline"));
  });

  // upgradePassport back-fills a stored pre-0.4.0 blocker it can't classify as `auto.unclassified.<i>`
  // and documents that id as positional and NOT durable. Keying a decision on it would silently
  // re-point that decision at a different blocker when the list order changes — strictly worse than
  // the prose hash, which at least rotates honestly.
  it("refuses a positional `unclassified` back-fill id and uses the prose key instead", () => {
    const backfilled = { id: "auto.unclassified.3", code: "unclassified", text: "Something the migration could not classify." };
    expect(passportFindingKey("acme/api", backfilled)).toBe(blockerKey("acme/api", backfilled.text));
  });

  it("offers the legacy prose key as a second read, so a pre-0.4.0 decision still resolves", () => {
    expect(passportFindingKeys("acme/api", obs)).toEqual([
      "acme/api::prod.zero-observability",
      blockerKey("acme/api", obs.text),
    ]);
    // Nothing to dual-read when the two derivations already agree.
    expect(passportFindingKeys("acme/api", { text: "No CI" })).toEqual([blockerKey("acme/api", "No CI")]);
  });
});

describe("passportFindings — id-keyed rows", () => {
  const obs = { id: "prod.zero-observability", code: "zero-observability", text: "Zero observability." };

  it("prefers `findings` over `blockers` and keys each on its id", () => {
    const found = passportFindings([{ fullName: "acme/api", blockers: ["stale prose"], findings: [obs] }]);
    expect(found.map((f) => f.itemKey)).toEqual(["acme/api::prod.zero-observability"]);
    expect(found[0]!.title).toBe("Zero observability.");
  });

  it("collapses one cause listed on both axes into a single finding", () => {
    const found = passportFindings([
      { fullName: "acme/api", blockers: [], findings: [obs, { ...obs, text: "Reworded on the other axis." }] },
    ]);
    expect(found).toHaveLength(1);
  });

  it("still reads `blockers` when the caller has no findings (the pre-0.4.0 path is unchanged)", () => {
    const found = passportFindings([{ fullName: "acme/api", blockers: ["No CI pipeline"] }]);
    expect(found[0]!.itemKey).toBe(blockerKey("acme/api", "No CI pipeline"));
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

// MOONSHOT #33 — key stability is the whole contract: a decision recorded against a drifted adoption
// must survive the next scan, which means the key can carry nothing that a rescan or a reword moves.
describe("practiceFindings", () => {
  const drifted = {
    repoFullName: "acme/api",
    practiceId: "agent-guidance",
    artifactPath: "AGENTS.md",
    state: "drifted",
    label: "Agent guidance",
  };

  it("keys on repo + practice + artifact path, never on wording", () => {
    const [a] = practiceFindings([drifted]);
    const [b] = practiceFindings([{ ...drifted, label: "Completely different label" }]);
    expect(a!.itemKey).toBe("acme/api:agent-guidance:AGENTS.md");
    expect(b!.itemKey).toBe(a!.itemKey);
  });

  it("separates two artifacts of the same practice in the same repo", () => {
    const keys = practiceFindings([drifted, { ...drifted, artifactPath: "docs/AGENTS.md" }]).map((f) => f.itemKey);
    expect(new Set(keys).size).toBe(2);
  });

  it("emits a finding only for drifted and removed rows", () => {
    const states = ["proposed", "adopted", "superseded", "drifted", "removed"];
    const out = practiceFindings(states.map((state, i) => ({ ...drifted, state, artifactPath: `f${i}.md` })));
    expect(out.map((f) => f.module)).toEqual(["practices", "practices"]);
  });

  it("says what was removed vs what diverged, and names neither as a PR to open", () => {
    const [removed] = practiceFindings([{ ...drifted, state: "removed" }]);
    const [diverged] = practiceFindings([drifted]);
    expect(removed!.detail).toContain("no longer in the default branch");
    expect(diverged!.detail).toContain("no longer matches the structure that landed");
    // Both offer "record it" as a real outcome — drift is decided, never auto-reapplied.
    expect(removed!.detail).toContain("record that");
    expect(diverged!.detail).toContain("Accept the divergence");
  });

  it("falls back to the practice id when no label is known", () => {
    const [f] = practiceFindings([{ ...drifted, label: undefined }]);
    expect(f!.subject).toBe("agent-guidance");
  });
});

describe("isFindingModule", () => {
  it("accepts the five promoted modules and rejects anything else", () => {
    expect(["security", "teams", "passports", "contributors", "practices"].every(isFindingModule)).toBe(true);
    expect(isFindingModule("backlog")).toBe(false);
    expect(isFindingModule(null)).toBe(false);
  });
});
