// export-1 (challenge-2026-10-22d): the scoped LLM briefing - grammar, narrowing, the partiality
// line, the href and the size readout. Pure, so no mocks: the real generator renders every case.

import { describe, expect, it } from "vitest";
import type { LiftDistribution } from "@/lib/outcomes/aggregate";
import type { DimensionId, ScanReport } from "@/lib/types";
import { reportLlmMarkdown } from "@/lib/report/llm-markdown";
import { recommendationMatchKey } from "@/lib/report/rec-identity";
import {
  briefingHref,
  briefingLiftOrg,
  briefingPreview,
  composeBriefing,
  parseBriefingScope,
  scopeReportForBriefing,
} from "./briefing-scope";

const IDS = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9"] as DimensionId[];

function nineDimReport(): ScanReport {
  return {
    repo: { owner: "acme", name: "app", url: "https://github.com/acme/app", stars: 1, forks: 0, defaultBranch: "main", headSha: "sha" },
    overallScore: 55,
    level: { id: "L3", name: "Practicing", band: [50, 69], tagline: "t", description: "d" },
    archetype: "team",
    adoptionScore: 50,
    rigorScore: 60,
    posture: { id: "ai-native", label: "AI-native", blurb: "b" },
    aiUsage: { detected: false, commitFraction: 0, signals: [] },
    contributors: [],
    dimensions: IDS.map((id) => ({
      id,
      name: `Dim ${id}`,
      weight: 0.11,
      score: 40,
      signalScore: 40,
      llmScore: 40,
      summary: `summary-${id}`,
      evidence: [`evidence-${id}`],
      strengths: [],
      gaps: [`gap-${id}`],
    })),
    headline: "h",
    strengths: ["s1"],
    risks: ["r1"],
    roadmap: IDS.map((id) => ({ title: `Fix ${id}`, dimension: id, impact: "high", effort: "low", rationale: `why-${id}` })),
    discrepancies: [{ dimension: "D3", claim: "claim-D3" }, { dimension: "D5", claim: "claim-D5" }],
    confidence: 0.8,
    scannedAt: "2026-10-01T00:00:00.000Z",
    engine: { provider: "bedrock", model: "m" },
  } as unknown as ScanReport;
}

function liftFor(dim: string, title: string): Map<string, LiftDistribution> {
  const key = recommendationMatchKey(dim, title);
  return new Map([[key, {
    identityKey: key, dimId: dim, n: 12, orgs: 1, medianDim: 6, p25: 3, p75: 9, medianOverall: 2,
    instrument: { rubricVersion: "r10", engineProvider: "bedrock" },
  }]]);
}

const R = nineDimReport();

describe("parseBriefingScope - the /api/report/skill dims grammar", () => {
  it("comma list and repeated params parse to the same selection", () => {
    expect(parseBriefingScope(new URLSearchParams("dims=D3,D9"), R)).toEqual({ ok: true, dims: ["D3", "D9"] });
    expect(parseBriefingScope(new URLSearchParams("dims=D3&dims=D9"), R)).toEqual({ ok: true, dims: ["D3", "D9"] });
  });

  it("an id the report does not carry fails closed", () => {
    expect(parseBriefingScope(new URLSearchParams("dims=D99"), R)).toEqual({ ok: false, error: "Unknown dimension: D99" });
    expect(parseBriefingScope(new URLSearchParams("dims="), R).ok).toBe(false);
  });

  it("guard: no ?dims is the whole report", () => {
    expect(parseBriefingScope(new URLSearchParams("repo=acme/app"), R)).toEqual({ ok: true, dims: null });
  });
});

describe("scoped briefing body", () => {
  const scopeNote = "Scoped briefing: 1 of 9 dimensions (D3). Overall score and level are whole-repository figures.";

  it("carries only D3 rows and leads with the partiality line", () => {
    const md = reportLlmMarkdown(scopeReportForBriefing(R, ["D3"]), { scopeNote });
    for (const id of IDS.filter((i) => i !== "D3")) {
      expect(md).not.toContain(`| ${id} |`);
      expect(md).not.toContain(`gap-${id}`);
      expect(md).not.toContain(`evidence-${id}`);
      expect(md).not.toContain(`Fix ${id}`);
    }
    expect(md).toContain("| D3 |");
    expect(md).toContain("- gap-D3");
    expect(md).toContain("- evidence-D3");
    expect(md).toContain("**Fix D3**");
    expect(md).toContain("claim-D3");
    expect(md).not.toContain("claim-D5");
    expect(md).toContain(`> ${scopeNote}`);
    expect(md.indexOf(scopeNote)).toBeLessThan(md.indexOf("**Overall"));
    expect(md).not.toContain(String.fromCharCode(0x2014));
  });

  it("composeBriefing emits that same scoped document", () => {
    expect(composeBriefing(R, ["D3"])).toBe(reportLlmMarkdown(scopeReportForBriefing(R, ["D3"]), { scopeNote }));
  });

  it("guard: no selection, or every dimension, is byte-identical to reportLlmMarkdown(report)", () => {
    expect(composeBriefing(R, null)).toBe(reportLlmMarkdown(R));
    expect(composeBriefing(R, IDS)).toBe(reportLlmMarkdown(R));
    expect(reportLlmMarkdown(R, { scopeNote: null })).toBe(reportLlmMarkdown(R));
  });

  it("a lift for a scoped roadmap item rides as the measured clause", () => {
    const md = composeBriefing(R, ["D3"], liftFor("D3", "Fix D3"));
    expect(md).toContain("   - _measured:_ D3 +6 median");
  });
});

describe("briefingHref and briefingPreview", () => {
  it("encodes the repo and the selection", () => {
    expect(briefingHref({ repo: "acme/app@sha", dims: ["D3"] })).toBe("/api/report/llm?repo=acme%2Fapp%40sha&dims=D3");
    expect(briefingHref({ repo: "acme/app", dims: [] })).toBe("/api/report/llm?repo=acme%2Fapp");
    expect(briefingHref({ repo: "acme/app", dims: ["D3", "D9"], org: "rebrand" })).toBe(
      "/api/report/llm?repo=acme%2Fapp&dims=D3,D9&org=rebrand",
    );
  });

  it("previews the exact text: lines, chars and ceil(chars/4) tokens", () => {
    expect(briefingPreview("ab\ncde")).toEqual({ lines: 2, chars: 6, approxTokens: 2 });
  });
});

describe("briefingLiftOrg - never more than the page reads", () => {
  it("the owner org, or public with no hint; a redirecting hint carries none", () => {
    expect(briefingLiftOrg("acme", "Acme", null)).toBe("acme");
    expect(briefingLiftOrg("public", "acme", null)).toBe("public");
    expect(briefingLiftOrg("public", "acme", "other")).toBe("public");
    expect(briefingLiftOrg("rebrand", "acme", "rebrand")).toBeNull();
    expect(briefingLiftOrg("public", "acme", "public")).toBeNull();
  });
});
