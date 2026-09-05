// The stance module's pure contracts (W3): sanitizeStance mirrors sanitizeGatePolicy's discipline
// (untrusted input → clean shape or null), repoGlobMatches is the only glob semantics any stance
// surface may use, and evaluateStanceCompliance is strictly "declared vs OBSERVED attribution" —
// version-stamped, advisory-labeled, and never inventing a breach from absent data.

import { describe, expect, it } from "vitest";
import {
  ackState,
  evaluateStanceCompliance,
  repoGlobMatches,
  sanitizeStance,
  type StanceRepoFacts,
} from "./stance";
import type { AiStance } from "@/lib/types";

const baseStance = (over: Partial<AiStance> = {}): AiStance => ({
  permittedTools: ["Claude Code", "Copilot"],
  permittedModels: ["claude-opus"],
  noAiZones: [],
  reviewTiers: [],
  provenance: { requireTrailer: false, requireHumanApproval: false },
  ...over,
});

const facts = (over: Partial<StanceRepoFacts> = {}): StanceRepoFacts => ({
  name: "api",
  fullName: "acme/api",
  level: "L3",
  overall: 62,
  autonomyTier: "T1",
  observedTools: [],
  aiInvolvedRate: null,
  aiTrailerRate: null,
  unapprovedAiChanges: 0,
  ackedVersion: null,
  ...over,
});

describe("sanitizeStance", () => {
  it("returns null for garbage and for an all-empty stance", () => {
    expect(sanitizeStance(null)).toBeNull();
    expect(sanitizeStance("x")).toBeNull();
    expect(sanitizeStance({})).toBeNull();
    expect(
      sanitizeStance({ permittedTools: [], noAiZones: [], provenance: { requireTrailer: false } }),
    ).toBeNull();
  });

  it("trims, dedupes (case-insensitive) and drops non-string list entries", () => {
    const s = sanitizeStance({ permittedTools: ["  Claude Code ", "claude code", 7, "", "Copilot"] });
    expect(s?.permittedTools).toEqual(["Claude Code", "Copilot"]);
  });

  it("drops zones that seal nothing and keeps a trimmed reason", () => {
    const s = sanitizeStance({
      noAiZones: [
        { repoGlobs: [], pathGlobs: [] },
        { repoGlobs: ["acme/billing-*"], pathGlobs: ["prisma/migrations/**"], reason: "  PCI scope " },
        "junk",
      ],
    });
    expect(s?.noAiZones).toEqual([
      { repoGlobs: ["acme/billing-*"], pathGlobs: ["prisma/migrations/**"], reason: "PCI scope" },
    ]);
  });

  it("keeps only valid tier ids, dedupes per tier, and sorts T0→T3", () => {
    const s = sanitizeStance({
      reviewTiers: [
        { tier: "T2", review: "Two approvals." },
        { tier: "T2", review: "duplicate — dropped" },
        { tier: "T9", review: "bogus tier" },
        { tier: "T0", review: "Normal review." },
        { tier: "T1", review: "   " },
      ],
    });
    expect(s?.reviewTiers).toEqual([
      { tier: "T0", review: "Normal review." },
      { tier: "T2", review: "Two approvals." },
    ]);
  });

  it("provenance flags are strict booleans (truthy strings do not count)", () => {
    const s = sanitizeStance({ provenance: { requireTrailer: "yes", requireHumanApproval: true } });
    expect(s?.provenance).toEqual({ requireTrailer: false, requireHumanApproval: true });
  });

  it("a stance carried ONLY by a provenance flag is still a stance", () => {
    expect(sanitizeStance({ provenance: { requireTrailer: true } })).not.toBeNull();
  });
});

describe("repoGlobMatches", () => {
  it("matches exact fullName, case-insensitively", () => {
    expect(repoGlobMatches("acme/api", "acme/api")).toBe(true);
    expect(repoGlobMatches("ACME/API", "acme/api")).toBe(true);
    expect(repoGlobMatches("acme/api", "acme/api2")).toBe(false);
  });

  it("* stays within a segment; ** crosses it", () => {
    expect(repoGlobMatches("acme/*", "acme/api")).toBe(true);
    expect(repoGlobMatches("acme*", "acme/api")).toBe(false); // "*" can't cross the "/"
    expect(repoGlobMatches("**", "acme/api")).toBe(true);
    expect(repoGlobMatches("acme/billing-*", "acme/billing-service")).toBe(true);
    expect(repoGlobMatches("acme/billing-*", "acme/web")).toBe(false);
  });

  it("a bare pattern (no slash) also matches the repo NAME", () => {
    expect(repoGlobMatches("billing-service", "acme/billing-service")).toBe(true);
    expect(repoGlobMatches("billing-*", "acme/billing-service")).toBe(true);
    expect(repoGlobMatches("billing-service", "acme/web")).toBe(false);
  });

  it("regex metacharacters in a glob are literal, not regex", () => {
    expect(repoGlobMatches("acme/a.b", "acme/a.b")).toBe(true);
    expect(repoGlobMatches("acme/a.b", "acme/axb")).toBe(false);
    expect(repoGlobMatches("acme/a+b(c)?", "acme/a+b(c)?")).toBe(true);
  });
});

describe("evaluateStanceCompliance", () => {
  it("stamps the evaluated stance version into the ack state", () => {
    const r3 = evaluateStanceCompliance(baseStance(), facts({ ackedVersion: 3 }), 3);
    expect(r3.ack).toBe("current");
    // The SAME facts evaluated against v4 must read stale — the version stamp, not a global flag.
    const r4 = evaluateStanceCompliance(baseStance(), facts({ ackedVersion: 3 }), 4);
    expect(r4.ack).toBe("stale");
    expect(evaluateStanceCompliance(baseStance(), facts(), 4).ack).toBe("unacked");
    expect(ackState(null, 1)).toBe("unacked");
  });

  it("flags observed tools the allowlist never declared — and stays quiet with no allowlist", () => {
    const r = evaluateStanceCompliance(baseStance(), facts({ observedTools: ["Claude", "Devin"] }), 1);
    // "Claude" is covered by "Claude Code" (substring either way); "Devin" is undeclared.
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ code: "undeclared-tool", advisory: false });
    expect(r.findings[0]!.message).toContain("Devin");
    expect(r.compliant).toBe(false);

    const noList = evaluateStanceCompliance(baseStance({ permittedTools: [] }), facts({ observedTools: ["Devin"] }), 1);
    expect(noList.findings).toHaveLength(0);
  });

  it("trailer provenance: gap between AI-involved and trailer-carrying merges is a finding; no sample is not", () => {
    const stance = baseStance({ provenance: { requireTrailer: true, requireHumanApproval: false } });
    const gap = evaluateStanceCompliance(stance, facts({ aiInvolvedRate: 40, aiTrailerRate: 10 }), 1);
    expect(gap.provenancePct).toBe(10);
    expect(gap.findings[0]).toMatchObject({ code: "provenance-trailer", advisory: false });

    // Unmeasured (pre-W2 blob / below floor) → no fabricated breach, provenancePct stays null.
    const unmeasured = evaluateStanceCompliance(stance, facts({ aiInvolvedRate: 40, aiTrailerRate: null }), 1);
    expect(unmeasured.provenancePct).toBeNull();
    expect(unmeasured.findings).toHaveLength(0);

    // Full coverage → clean.
    const clean = evaluateStanceCompliance(stance, facts({ aiInvolvedRate: 40, aiTrailerRate: 40 }), 1);
    expect(clean.findings).toHaveLength(0);
  });

  it("human-approval provenance counts persisted unapproved MERGED AiChange rows", () => {
    const stance = baseStance({ provenance: { requireTrailer: false, requireHumanApproval: true } });
    const r = evaluateStanceCompliance(stance, facts({ unapprovedAiChanges: 3 }), 1);
    expect(r.findings[0]).toMatchObject({ code: "unapproved-ai-change", advisory: false });
    expect(r.findings[0]!.message).toContain("3");
    expect(evaluateStanceCompliance(stance, facts(), 1).findings).toHaveLength(0);
  });

  it("a sealed repo (repoGlob match) with observed AI attribution is a finding; sealed alone is not", () => {
    const stance = baseStance({ noAiZones: [{ repoGlobs: ["acme/api"], pathGlobs: [] }] });
    const quiet = evaluateStanceCompliance(stance, facts(), 1);
    expect(quiet.sealed).toBe(true);
    expect(quiet.findings).toHaveLength(0); // nothing observed — no breach invented

    const breached = evaluateStanceCompliance(stance, facts({ aiInvolvedRate: 12 }), 1);
    expect(breached.findings[0]).toMatchObject({ code: "no-ai-zone-repo", advisory: false });
  });

  it("wording never claims enforcement — findings speak of observation/attribution", () => {
    const stance = baseStance({
      noAiZones: [{ repoGlobs: ["acme/api"], pathGlobs: [] }],
      provenance: { requireTrailer: true, requireHumanApproval: true },
    });
    const r = evaluateStanceCompliance(
      stance,
      facts({ observedTools: ["Devin"], aiInvolvedRate: 40, aiTrailerRate: 5, unapprovedAiChanges: 1 }),
      1,
    );
    for (const f of r.findings) expect(f.message.toLowerCase()).not.toContain("enforce");
  });
});
