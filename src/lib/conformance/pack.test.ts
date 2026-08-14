import { describe, expect, it } from "vitest";
import { buildConformancePack, verdictFor, ATTESTATION } from "./pack";
import { packFiles, packSampleCsv } from "./csv";
import type { AiChangePopulation, AiChangeRecord, RepoControlEnvironment } from "@/lib/db/ai-changes";

const change = (over: Partial<AiChangeRecord> = {}): AiChangeRecord => ({
  repoFullName: "acme/web",
  prNumber: 1,
  title: "Add caching",
  authorLogin: "dev-one",
  authorIsBot: false,
  aiSignal: "marked",
  aiTools: "Claude Code",
  state: "MERGED",
  createdAt: "2026-06-01T00:00:00.000Z",
  mergedAt: "2026-06-02T00:00:00.000Z",
  approved: true,
  approverLogin: "lead-one",
  approvedAt: "2026-06-02T00:00:00.000Z",
  reviewCount: 1,
  ...over,
});

const env = (over: Partial<RepoControlEnvironment> = {}): RepoControlEnvironment => ({
  repoFullName: "acme/web",
  governance: {
    defaultBranch: "main",
    protected: true,
    requiresPullRequest: true,
    requiredApprovals: 1,
    requiresCodeOwnerReview: true,
    requiresStatusChecks: true,
    requiresSignatures: false,
    linearHistory: false,
    readable: true,
  },
  scannedAt: "2026-08-01T00:00:00.000Z",
  engineProvider: "claude-cli",
  engineModel: "claude-opus-5",
  ...over,
});

const population = (changes: AiChangeRecord[], environments = [env()]): AiChangePopulation => ({
  changes,
  environments,
  observedFrom: changes[0]?.createdAt ?? null,
  observedTo: changes[changes.length - 1]?.createdAt ?? null,
});

const opts = {
  org: "acme",
  period: { from: "2026-05-01", to: "2026-08-01", label: "Last 90 days" },
  generatedAt: "2026-08-14T00:00:00.000Z",
};

const build = (changes: AiChangeRecord[], o: Partial<typeof opts> & { sampleSize?: number; identityMode?: "pseudonymous" | "named" } = {}) =>
  buildConformancePack(population(changes), { ...opts, ...o });

describe("verdictFor — the deterministic per-item control judgement", () => {
  it("operated: merged with an approving review", () => {
    expect(verdictFor(change())).toBe("operated");
  });

  // The finding an auditor is looking for.
  it("not-operated: merged with no review at all", () => {
    expect(verdictFor(change({ approved: false, approverLogin: null, reviewCount: 0 }))).toBe("not-operated");
  });

  // Distinct from "nobody looked" — an examiner will ask which, and conflating them overstates the
  // control environment in one direction and understates it in the other.
  it("reviewed-not-approved: merged after review activity but with no approval", () => {
    expect(verdictFor(change({ approved: false, approverLogin: null, reviewCount: 3 }))).toBe("reviewed-not-approved");
  });

  it("not-applicable: never merged, so the pre-merge control was never due", () => {
    expect(verdictFor(change({ state: "OPEN", mergedAt: null, approved: false }))).toBe("not-applicable");
    expect(verdictFor(change({ state: "CLOSED", mergedAt: null, approved: false }))).toBe("not-applicable");
  });
});

describe("population summary", () => {
  it("counts merged, governed and ungoverned over merged rows only", () => {
    const p = build([
      change({ prNumber: 1, approved: true }),
      change({ prNumber: 2, approved: false, approverLogin: null, reviewCount: 0 }),
      change({ prNumber: 3, approved: false, approverLogin: null, reviewCount: 2 }),
      // An open PR is in the population but is not a merged-control denominator.
      change({ prNumber: 4, state: "OPEN", mergedAt: null, approved: false, approverLogin: null }),
    ]);
    expect(p.population).toMatchObject({
      total: 4,
      merged: 3,
      governed: 1,
      ungoverned: 2,
      reviewedNotApproved: 1,
    });
  });

  it("keeps agent-authored and human-marked separate — they carry different governance weight", () => {
    const p = build([change({ prNumber: 1, aiSignal: "authored" }), change({ prNumber: 2, aiSignal: "marked" })]);
    expect(p.population.agentAuthored).toBe(1);
    expect(p.population.markedByHuman).toBe(1);
  });
});

describe("findings", () => {
  // A sample bounds the work an AUDITOR does. It must never bound what the VENDOR discloses — the
  // findings are drawn from the full population regardless of what the sample happened to catch.
  it("reports every ungoverned merge in the FULL population, not only the sampled ones", () => {
    const changes = Array.from({ length: 100 }, (_, i) =>
      change({ prNumber: i + 1, approved: i % 10 !== 0, approverLogin: i % 10 !== 0 ? "lead" : null, reviewCount: 0 }),
    );
    const p = build(changes, { sampleSize: 5 });
    expect(p.sample.size).toBe(5);
    expect(p.findings).toHaveLength(10); // every 10th row, all of them
    expect(p.findings.every((f) => f.verdict === "not-operated")).toBe(true);
  });

  it("is empty when every merged change was approved", () => {
    expect(build([change(), change({ prNumber: 2 })]).findings).toEqual([]);
  });
});

describe("identity handling", () => {
  it("pseudonymizes by default and never leaks a real login", () => {
    const p = build([change({ authorLogin: "dev-one", approverLogin: "lead-one" })]);
    const json = JSON.stringify(p);
    expect(json).not.toContain("dev-one");
    expect(json).not.toContain("lead-one");
    expect(p.sample.items[0]!.author).toMatch(/^Person [A-Z]{2}$/);
  });

  it("is stable within a pack — the same person is the same pseudonym everywhere", () => {
    const p = build([
      change({ prNumber: 1, authorLogin: "dev-one" }),
      change({ prNumber: 2, authorLogin: "dev-one" }),
      change({ prNumber: 3, authorLogin: "dev-two" }),
    ]);
    const [a, b, c] = p.sample.items;
    expect(a!.author).toBe(b!.author);
    expect(a!.author).not.toBe(c!.author);
  });

  // Unlinkable ACROSS packs: correlating two periods' packs must not re-identify anyone.
  it("gives the same person different pseudonyms in different periods", () => {
    const q1 = build([change({ authorLogin: "dev-one" })], { period: { from: "2026-01-01", to: "2026-04-01", label: "Q1" } });
    const q2 = build([change({ authorLogin: "dev-one" })], { period: { from: "2026-04-01", to: "2026-07-01", label: "Q2" } });
    expect(q1.sample.items[0]!.author).not.toBe(q2.sample.items[0]!.author);
  });

  it("emits real logins only under the named mode", () => {
    const p = build([change({ authorLogin: "dev-one", approverLogin: "lead-one" })], { identityMode: "named" });
    expect(p.sample.items[0]!.author).toBe("dev-one");
    expect(p.sample.items[0]!.approver).toBe("lead-one");
  });

  it("renders a deleted account honestly rather than as an empty name", () => {
    expect(build([change({ authorLogin: null })]).sample.items[0]!.author).toBe("(deleted account)");
  });
});

describe("limitations — the disclosures that make the artifact usable", () => {
  it("always states that the population is a lower bound", () => {
    const p = build([change()]);
    expect(p.limitations.some((l) => l.includes("LOWER BOUND"))).toBe(true);
    expect(p.limitations.some((l) => l.toLowerCase().includes("unmarked"))).toBe(true);
  });

  it("discloses pseudonymization, and drops that note under named mode", () => {
    expect(build([change()]).limitations.some((l) => l.includes("pseudonymous"))).toBe(true);
    expect(build([change()], { identityMode: "named" }).limitations.some((l) => l.includes("pseudonymous"))).toBe(false);
  });

  // A mock-scored repo in an evidence pack is material, not a footnote.
  it("names how many repos were last scored by the deterministic mock engine", () => {
    const p = buildConformancePack(
      population([change()], [env({ engineProvider: "mock", engineModel: "deterministic" })]),
      opts,
    );
    expect(p.limitations.some((l) => l.includes("deterministic mock engine"))).toBe(true);
  });

  it("says nothing about mock engines when none were used", () => {
    expect(build([change()]).limitations.some((l) => l.includes("mock"))).toBe(false);
  });
});

describe("claims discipline — the sentences that must never drift", () => {
  it("says EVIDENCE FOR, and every compliance/certification word is inside a DISCLAIMER", () => {
    const all = Object.values(ATTESTATION).join(" ");
    expect(all).toContain("EVIDENCE FOR");
    expect(all).toMatch(/certifies nothing/i);

    // The rule isn't "never say the word" — the attestation has to name what it is NOT, and doing so
    // requires the words. The rule is that no sentence may ASSERT one. So: split into sentences and
    // require every sentence carrying a compliance/certification claim to also carry a negation.
    const risky = /\b(compliance with|compliant with|certified|certification|conformity)\b/i;
    const negated = /\b(not|never|no|nothing|makes no)\b/i;
    const offenders = all
      .split(/(?<=\.)\s+/)
      .filter((s) => risky.test(s) && !negated.test(s));
    expect(offenders).toEqual([]);
  });

  it("anchors to SOC 2 CC8.1 and offers ISO 42001 only as an input", () => {
    expect(ATTESTATION.control).toContain("CC8.1");
    expect(ATTESTATION.control).toContain("42001");
    expect(ATTESTATION.control).toMatch(/the examiner decides/i);
  });

  // AI-Act framing was dropped deliberately (AI-SDLC-STANDARDS-LANDSCAPE.md §5). The pack must say
  // so out loud rather than merely omitting it, because buyers ask.
  it("explicitly disclaims the EU AI Act rather than staying silent", () => {
    expect(ATTESTATION.notAiAct).toMatch(/NO claim under the EU AI Act/);
    expect(ATTESTATION.notAiAct).toContain("2027");
  });

  it("names the sampling algorithm so a third party can reproduce the draw", () => {
    const p = build([change()]);
    expect(p.sample.algorithm).toContain("Fisher-Yates");
    expect(p.sample.algorithm).toContain("mulberry32");
    expect(p.sample.seed).toBe("acme:2026-05-01:2026-08-01");
  });
});

describe("serialization", () => {
  it("omits PR titles from the CSV while keeping the column visible", () => {
    const csv = packSampleCsv(build([change({ title: "Fix ACME-1234 for BigCorp" })]));
    expect(csv).not.toContain("BigCorp");
    expect(csv).toContain("title_omitted");
    expect(csv).toContain("(omitted, identify via repository + pr_number)");
  });

  it("carries the control environment onto each row", () => {
    const csv = packSampleCsv(build([change()]));
    expect(csv).toContain("requires_codeowner_review");
    expect(csv).toContain("operated");
  });

  it("manifest carries the seed, the limitations and both file hashes", () => {
    const { manifest, sample, findings } = packFiles(build([change({ approved: false, approverLogin: null, reviewCount: 0 })]));
    expect(manifest).toContain("acme:2026-05-01:2026-08-01");
    expect(manifest).toContain("Read these limitations first");
    expect(manifest).toMatch(/`sample\.csv` SHA-256: `[0-9a-f]{64}`/);
    expect(manifest).toMatch(/`findings\.csv` SHA-256: `[0-9a-f]{64}`/);
    expect(sample.split("\n")[0]).toContain("control_verdict");
    expect(findings).toContain("not-operated");
  });

  it("the manifest states the limitations BEFORE the population numbers", () => {
    const { manifest } = packFiles(build([change()]));
    expect(manifest.indexOf("Read these limitations first")).toBeLessThan(manifest.indexOf("## Population"));
  });
});

describe("empty and edge populations", () => {
  it("builds an honest empty pack rather than failing", () => {
    const p = buildConformancePack(population([], []), opts);
    expect(p.population).toMatchObject({ total: 0, merged: 0, governed: 0, ungoverned: 0, repos: 0 });
    expect(p.sample.items).toEqual([]);
    expect(p.findings).toEqual([]);
    expect(p.sample.exhaustive).toBe(true);
  });

  it("renders a null control environment as absent, never as unprotected", () => {
    const p = buildConformancePack(population([change()], [env({ governance: null })]), opts);
    expect(p.sample.items[0]!.environment).toBeNull();
  });
});
