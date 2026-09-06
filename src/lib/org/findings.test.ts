// Unit tests for derived-finding promotion. The property everything else depends on is KEY STABILITY:
// a decision is stored against `itemKey`, so if a key rotates across scans the decision orphans and a
// dismissed finding silently returns to the rail's badge. These tests pin exactly that — keys ride
// stable ids where they exist, survive cosmetic text churn where they don't, and change when the
// finding genuinely changes.

import { describe, expect, it } from "vitest";
import {
  blockerKey,
  blockerKeys,
  findingItemKey,
  contributorFindings,
  fnv1a,
  isFindingModule,
  practiceFindings,
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

  it("rotates the LEGACY key when the blocker is reworded — the defect the id key exists to fix", () => {
    expect(blockerKey("acme/api", "No CI pipeline")).not.toBe(blockerKey("acme/api", "No CD pipeline"));
  });

  it("de-duplicates a blocker listed on both readiness axes", () => {
    const found = passportFindings([{ fullName: "acme/api", blockers: ["No CI", "no ci", "No tests"] }]);
    expect(found).toHaveLength(2);
  });

  it("drops blank blockers", () => {
    expect(passportFindings([{ fullName: "acme/api", blockers: ["", "   "] }])).toEqual([]);
  });

  // ── Direction 8: the key is the CAUSE, not the sentence ───────────────────────────────────────
  it("keys on the minted finding id when the caller supplies findings", () => {
    const found = passportFindings([
      {
        fullName: "acme/api",
        blockers: ["Agent can't self-verify (missing lint, test)."],
        findings: [{ id: "auto.self-verify-gaps", text: "Agent can't self-verify (missing lint, test)." }],
      },
    ]);
    expect(found[0]!.itemKey).toBe("acme/api::auto.self-verify-gaps");
    expect(found[0]!.itemKey).toBe(findingItemKey("acme/api", "auto.self-verify-gaps"));
  });

  it("SURVIVES the blocker text changing — the exact orphaning bug (self-verify lists the scripts)", () => {
    const before = passportFindings([
      {
        fullName: "acme/api",
        blockers: ["Agent can't self-verify (missing lint, test)."],
        findings: [{ id: "auto.self-verify-gaps", text: "Agent can't self-verify (missing lint, test)." }],
      },
    ]);
    // The repo adds a `lint` script; the sentence changes, the cause does not.
    const after = passportFindings([
      {
        fullName: "acme/api",
        blockers: ["Agent can't self-verify (missing test)."],
        findings: [{ id: "auto.self-verify-gaps", text: "Agent can't self-verify (missing test)." }],
      },
    ]);
    expect(after[0]!.itemKey).toBe(before[0]!.itemKey);
    // The legacy text key would have rotated — that is what orphaned the decision.
    expect(blockerKey("acme/api", "Agent can't self-verify (missing test).")).not.toBe(
      blockerKey("acme/api", "Agent can't self-verify (missing lint, test)."),
    );
  });

  it("falls back to the legacy text key for a pre-0.4.0 row that carries no findings", () => {
    const found = passportFindings([{ fullName: "acme/api", blockers: ["No CI pipeline"] }]);
    expect(found[0]!.itemKey).toBe(blockerKey("acme/api", "No CI pipeline"));
  });

  it("collapses two differently-worded sentences minted under ONE cause id into one finding", () => {
    const found = passportFindings([
      {
        fullName: "acme/api",
        blockers: ["Agent can't self-verify (missing lint).", "Agent can't self-verify (missing test)."],
        findings: [
          { id: "auto.self-verify-gaps", text: "Agent can't self-verify (missing lint)." },
          { id: "auto.self-verify-gaps", text: "Agent can't self-verify (missing test)." },
        ],
      },
    ]);
    expect(found).toHaveLength(1);
  });
});

describe("blockerKeys — the write key plus its read-only legacy alias", () => {
  it("returns [id key, legacy prose key] when a finding id is known", () => {
    const keys = blockerKeys("acme/api", "No CI pipeline", "prod.no-ci");
    expect(keys).toEqual(["acme/api::prod.no-ci", blockerKey("acme/api", "No CI pipeline")]);
  });

  it("returns ONLY the legacy key with no id — nothing is invented", () => {
    expect(blockerKeys("acme/api", "No CI pipeline")).toEqual([blockerKey("acme/api", "No CI pipeline")]);
    expect(blockerKeys("acme/api", "No CI pipeline", null)).toHaveLength(1);
  });

  it("the write key is stable across a rewording that rotates the legacy alias", () => {
    const a = blockerKeys("acme/api", "old wording", "auto.x");
    const b = blockerKeys("acme/api", "NEW wording entirely", "auto.x");
    expect(b[0]).toBe(a[0]);
    expect(b[1]).not.toBe(a[1]);
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
