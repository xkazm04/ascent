import { describe, it, expect } from "vitest";
import { buildGateComment, GATE_COMMENT_MARKER } from "./gate-comment";
import type { GateResult } from "./gate";
import type { ScanReport } from "@/lib/types";
import { levelForScore, postureFor } from "@/lib/maturity/model";

function report(over: Partial<ScanReport> = {}): ScanReport {
  const overall = over.overallScore ?? 58;
  return {
    repo: { owner: "acme", name: "api", url: "https://github.com/acme/api", stars: 0, forks: 0, defaultBranch: "main" },
    overallScore: overall,
    level: levelForScore(overall),
    archetype: "org",
    adoptionScore: 55,
    rigorScore: 60,
    posture: postureFor(55, 60),
    aiUsage: { detected: true, commitFraction: 0.4, signals: [] },
    contributors: [],
    dimensions: [],
    headline: "",
    strengths: [],
    risks: [],
    roadmap: [
      { title: "Few tests vouch for behavior", dimension: "D2", impact: "high", effort: "medium", rationale: "", explore: ["What would catch a regression before merge?"] },
    ],
    discrepancies: [],
    confidence: 0.8,
    scannedAt: "2026-05-31T00:00:00.000Z",
    engine: { provider: "mock", model: "rubric" },
    ...over,
  };
}

const passGate: GateResult = { pass: true, policy: { minLevel: "L3", minDimension: 40 }, failures: [] };
const failGate: GateResult = {
  pass: false,
  policy: { minLevel: "L3", minDimension: 40 },
  failures: [{ code: "level", message: "Overall level L2 is below the required L3." }],
};

describe("buildGateComment", () => {
  it("renders a passing gate with success conclusion + marker", () => {
    const c = buildGateComment(report(), passGate);
    expect(c.conclusion).toBe("success");
    expect(c.title).toContain("Passed");
    expect(c.commentBody.startsWith(GATE_COMMENT_MARKER)).toBe(true);
    expect(c.summary).toContain("posture");
  });

  it("renders a failing gate and lists the failures", () => {
    const c = buildGateComment(report({ overallScore: 40 }), failGate);
    expect(c.conclusion).toBe("failure");
    expect(c.title).toContain("Failed");
    expect(c.summary).toContain("below the required L3");
    expect(c.summary).toContain("Gaps to explore");
  });

  it("shows the delta vs the previous scan when a baseline diff is provided", () => {
    const c = buildGateComment(report(), passGate, {
      overall: { before: 50, after: 58, delta: 8 },
      level: { before: { id: "L3", name: "Augmented" }, after: { id: "L3", name: "Augmented" }, changed: false, up: false },
      adoption: { before: 50, after: 55, delta: 5 },
      rigor: { before: 55, after: 60, delta: 5 },
      posture: { before: postureFor(50, 55), after: postureFor(55, 60), changed: false },
      dimensions: [],
      recsMovedToDone: [],
      closedGapCount: 0,
      openedGapCount: 0,
      appearedSignalCount: 0,
      disappearedSignalCount: 0,
      movements: [],
      unchanged: false,
    });
    expect(c.summary).toContain("overall +8");
    expect(c.summary).toContain("vs last scan");
  });

  it("labels the delta for a PR when baselineSuffix is overridden", () => {
    const c = buildGateComment(
      report(),
      passGate,
      {
        overall: { before: 50, after: 58, delta: 8 },
        level: { before: { id: "L3", name: "Augmented" }, after: { id: "L3", name: "Augmented" }, changed: false, up: false },
        adoption: { before: 50, after: 55, delta: 5 },
        rigor: { before: 55, after: 60, delta: 5 },
        posture: { before: postureFor(50, 55), after: postureFor(55, 60), changed: false },
        dimensions: [],
        recsMovedToDone: [],
        closedGapCount: 0,
        openedGapCount: 0,
        appearedSignalCount: 0,
        disappearedSignalCount: 0,
        movements: [],
        unchanged: false,
      },
      { baselineSuffix: "in this PR" },
    );
    expect(c.summary).toContain("overall +8 in this PR");
    expect(c.summary).not.toContain("vs last scan");
  });

  it("does not crash when a failing dimension has no `gaps` array (legacy/mock report)", () => {
    // NO `gaps` key — an LLM/mock/older persisted report can omit it; `d.gaps[0]` used to THROW here,
    // killing the entire check-run + sticky-comment write on a failing gate (when it matters most).
    const dims = [
      { id: "D9", name: "Supply Chain & Security", score: 20, weight: 1, signalScore: 20, llmScore: null, summary: "Thin on security checks", evidence: [], strengths: [] },
    ] as unknown as ScanReport["dimensions"];
    const fail: GateResult = {
      pass: false,
      policy: { minDimension: 40 },
      failures: [{ code: "dimension", message: "D9 Supply Chain & Security scored 20, below the required 40." }],
    };
    const c = buildGateComment(report({ overallScore: 30, dimensions: dims }), fail); // must not throw
    expect(c.conclusion).toBe("failure");
    expect(c.summary).toContain("Where the score falls short");
    expect(c.summary).toContain("Thin on security checks"); // d.summary used as the gap fallback
  });

  it("escapes a pipe + the comment marker in a dimension name (no broken table, no forged marker)", () => {
    const dims = [
      { id: "D9", name: "Sec | urity <!-- ascent-maturity-gate -->", score: 10, weight: 1, signalScore: 10, llmScore: null, summary: "x", evidence: [], strengths: [], gaps: ["a | b"] },
    ] as unknown as ScanReport["dimensions"];
    const fail: GateResult = {
      pass: false,
      policy: { minDimension: 40 },
      failures: [{ code: "dimension", message: "D9 scored 10, below the required 40." }],
    };
    const c = buildGateComment(report({ overallScore: 20, dimensions: dims }), fail);
    // The real marker appears exactly once (forged copy in the name is defused to &lt;!--).
    expect(c.commentBody.split(GATE_COMMENT_MARKER).length - 1).toBe(1);
    // The pipe in the name is escaped so the table row keeps its columns.
    expect(c.summary).toContain("Sec \\| urity");
  });

  it("flags a MOCK-scored verdict on the Check Run summary, not just the sticky comment", () => {
    // Default report() engine is { provider: "mock" } — a dev blocked by the gate must be able to
    // see on the check itself that the verdict came from the deterministic rubric, not the AI.
    const c = buildGateComment(report(), passGate);
    expect(c.summary).toContain("deterministic rubric");
    expect(c.summary).toContain("no LLM");
    expect(c.commentBody).toContain("deterministic rubric"); // summary is embedded in the comment too
  });

  it("names the LIVE provider on the Check Run summary when scored by an LLM (no mock warning)", () => {
    const c = buildGateComment(report({ engine: { provider: "claude-cli", model: "sonnet" } }), passGate);
    expect(c.summary).toContain("Scored by Ascent");
    expect(c.summary).toContain("claude-cli");
    expect(c.summary).not.toContain("deterministic rubric");
  });

  it("the policy footer reflects the FULL enforced policy — incl. the D9 floor + protected branch", () => {
    // DELIBERATE behavior change (ci-gate-and-status-checks.md #1): the footer is now derived from the
    // same canonical condition enumeration (describeGatePolicy) as the governance dashboard / gate URL
    // / CI snippet, so it can no longer omit the per-dimension Security (D9) floor or the
    // protected-branch requirement that the gate actually enforces.
    const gate: GateResult = {
      pass: true,
      policy: {
        minLevel: "L3",
        minOverall: 50,
        minDimension: 40,
        minDimensionFor: { D9: 50 },
        forbidPostures: ["ungoverned"],
        requireProtectedBranch: true,
      },
      failures: [],
    };
    const c = buildGateComment(report(), gate);
    expect(c.commentBody).toContain("Policy: min L3 · min overall 50 · no dim < 40 · no D9 < 50 · forbid ungoverned · protected branch");
  });
});
