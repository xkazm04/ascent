import { describe, it, expect } from "vitest";
import { buildGateComment, CHECK_SUMMARY_MAX_BYTES, GATE_COMMENT_MARKER } from "./gate-comment";
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
    // A SCORED dimension, deliberately: an empty `dimensions` array is what `isIncompleteReport`
    // reads as "nothing could be scored", and the builder now refuses to print a level/score headline
    // for such a report. A fixture that is structurally incomplete cannot stand in for a normal scan.
    dimensions: [
      { id: "D1", name: "Foundations", score: 70, weight: 1, signalScore: 70, llmScore: null, summary: "", evidence: [], strengths: [], gaps: [] },
    ] as unknown as ScanReport["dimensions"],
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

const passGate: GateResult = { pass: true, policy: { minLevel: "L3", minDimension: 40 }, failures: [], skipped: [] };
const failGate: GateResult = {
  pass: false,
  policy: { minLevel: "L3", minDimension: 40 },
  failures: [{ code: "level", message: "Overall level L2 is below the required L3." }],
  skipped: [],
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
      skipped: [],
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
      skipped: [],
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
      // Governance WAS read on this run (the App check run's scan carries a token), so the
      // protected-branch bar is enforced and the footer prints it unqualified.
      skipped: [],
    };
    const c = buildGateComment(report(), gate);
    expect(c.commentBody).toContain("Policy: min L3 · min overall 50 · no dim < 40 · no D9 < 50 · forbid ungoverned · protected branch");
  });

  // The gate's strongest turn-it-on argument was stated on NO gate surface: Security (D9) is the one
  // fully-deterministic dimension (engine.ts takes its signal score verbatim and excludes it from the
  // LLM guardband blend), so a D9 floor is a bar no model can talk its way past. It belongs on the PR,
  // beside the policy it qualifies — but only when a D9 floor is genuinely enforced, or it would be
  // marketing on a check that doesn't have one.
  it("tells the PR why the security floor is trustworthy — but ONLY when a D9 floor is enforced", () => {
    const withFloor = buildGateComment(
      report(),
      { pass: true, policy: { minLevel: "L3", minDimensionFor: { D9: 50 } }, failures: [], skipped: [] },
    );
    expect(withFloor.commentBody).toContain("fully deterministic");
    expect(withFloor.commentBody).toContain("never move the number");
    expect(withFloor.commentBody).toContain("Same tree, same verdict.");

    const withoutFloor = buildGateComment(report(), { pass: true, policy: { minLevel: "L3" }, failures: [], skipped: [] });
    expect(withoutFloor.commentBody).not.toContain("fully deterministic");
    // The claim lives in the COMMENT footer only — the check-run summary is the merge-blocking
    // surface and stays a verdict, not an argument.
    expect(withFloor.summary).not.toContain("fully deterministic");
  });
});

// github-app-installation-webhooks 2026-07-16 #3: the fork-PR fallback scores the DEFAULT BRANCH, not
// the PR head — that verdict must never post as a confident success/failure required-status result.
describe("buildGateComment — default-branch fallback (scoredHead: false)", () => {
  it("posts NEUTRAL (not success) and says it scored the default branch, even on a passing verdict", () => {
    const c = buildGateComment(report(), passGate, null, { scoredHead: false });
    expect(c.conclusion).toBe("neutral");
    expect(c.title).toContain("PR head not scored");
    expect(c.title).not.toMatch(/^Passed/); // no confident per-PR verdict framing
    expect(c.summary).toContain("Default-branch verdict");
    expect(c.summary).toContain("does not reflect the PR's own changes");
    // The sticky comment carries the same honest framing (it is built from the summary).
    expect(c.commentBody).toContain("does not reflect the PR's own changes");
  });

  it("posts NEUTRAL (not failure) on a failing fallback verdict — a red default branch must not block an innocent fork PR as its own failure", () => {
    const c = buildGateComment(report({ overallScore: 40 }), failGate, null, { scoredHead: false });
    expect(c.conclusion).toBe("neutral");
    expect(c.title).toContain("Default branch failed");
    expect(c.title).toContain("PR head not scored");
  });

  it("scoredHead: true (and the default) keep the exact confident per-PR framing", () => {
    expect(buildGateComment(report(), passGate, null, { scoredHead: true }).conclusion).toBe("success");
    expect(buildGateComment(report(), passGate).title).toMatch(/^Passed: /);
  });
});

// The sticky comment is the surface a developer actually reads in the PR timeline, and it had no link
// to the report at all — the verdict was a dead end for anyone wanting the reasoning behind it. The
// Check Run carries the same destination natively as `details_url`, so this belongs to the COMMENT only.
describe("buildGateComment — the way back to the report", () => {
  const url = "https://ascent.example.dev/report/acme/api/abc123";

  it("links the full report from the sticky comment", () => {
    const c = buildGateComment(report(), passGate, null, { reportUrl: url });
    expect(c.commentBody).toContain(`[**See the full report →**](<${url}>)`);
  });

  it("does NOT duplicate the link into the check-run summary (details_url already carries it)", () => {
    const c = buildGateComment(report(), passGate, null, { reportUrl: url });
    expect(c.summary).not.toContain(url);
  });

  it("renders no link when the URL is missing or not absolute (a misconfigured base URL stays silent)", () => {
    expect(buildGateComment(report(), passGate).commentBody).not.toContain("See the full report");
    expect(buildGateComment(report(), passGate, null, { reportUrl: "/report/acme/api" }).commentBody).not.toContain(
      "See the full report",
    );
    expect(buildGateComment(report(), passGate, null, { reportUrl: "javascript:alert(1)" }).commentBody).not.toContain(
      "See the full report",
    );
  });

  it("keeps the policy footer last, so the link never displaces the enforced bar", () => {
    const c = buildGateComment(report(), passGate, null, { reportUrl: url });
    expect(c.commentBody.trimEnd().endsWith("</sub>")).toBe(true);
    expect(c.commentBody.indexOf("See the full report")).toBeLessThan(c.commentBody.indexOf("<sub>Policy:"));
  });
});

// ---------------------------------------------------------------------------
// A SKIPPED CRITERION IS ANNOUNCED HERE TOO (quality-gates/unmeasurable-criteria)
//
// The PR comment is the surface a developer actually reads, and it was the surface that lied hardest:
// `Policy: … · protected branch` beside a green check asserted a control nothing had verified. These
// pin the two halves of the correction — the block that names what was not tested, and the mark on
// the echoed bar itself.
// ---------------------------------------------------------------------------
describe("buildGateComment — conditions that could not be measured", () => {
  const skippedGate: GateResult = {
    pass: true,
    policy: { minLevel: "L3", requireProtectedBranch: true },
    failures: [],
    skipped: [{ code: "governance", why: "Branch protection was NOT READ on this scan, so the rule was not tested." }],
  };

  it("renders a 'Not measured on this run' block naming the criterion and why", () => {
    const c = buildGateComment(report(), skippedGate);
    expect(c.summary).toContain("Not measured on this run");
    expect(c.summary).toContain("Protected default branch");
    expect(c.summary).toContain("NOT READ on this scan");
    // …and it survives into the sticky comment, which embeds the summary.
    expect(c.commentBody).toContain("Not measured on this run");
  });

  it("MARKS the skipped bar in the policy footer instead of dropping it", () => {
    // FAIL-BEFORE: the footer printed "protected branch" identically whether the rule was enforced or
    // never tested. The bar stays visible (it IS configured) but may not read as enforced.
    const c = buildGateComment(report(), skippedGate);
    expect(c.commentBody).toContain("protected branch (not measured)");
    // A bar that WAS evaluated keeps its plain rendering.
    expect(c.commentBody).toContain("min L3 ·");
    expect(c.commentBody).not.toContain("min L3 (not measured)");
  });

  it("says nothing when every configured condition was actually tested", () => {
    expect(buildGateComment(report(), passGate).summary).not.toContain("Not measured");
  });

  it("bounds the block and the whole summary, so a 100-control policy cannot break the check write", () => {
    // A check-run summary over 65535 bytes is REJECTED by GitHub — the merge-blocking status would
    // simply go missing, which is the worst possible failure for the surface that blocks merges.
    const many: GateResult = {
      pass: true,
      policy: { requireChecks: Array.from({ length: 100 }, (_, i) => `control.x${i}.check`) },
      failures: [],
      skipped: Array.from({ length: 100 }, (_, i) => ({ code: "control" as const, why: `"control.x${i}.check" was not judged: no conformance report.` })),
    };
    const c = buildGateComment(report(), many);
    expect(c.summary).toContain("more condition(s) this run could not test");
    expect(Buffer.byteLength(c.summary, "utf8")).toBeLessThan(CHECK_SUMMARY_MAX_BYTES);
  });
});

// An INCOMPLETE scan scored nothing, so its 0 / L1 is the renormalized floor and NOT a reading — the
// gate says so itself (`isIncompleteReport`: "is not a measurement") and then the headline printed
// `Failed: L1 Emerging (0/100)` anyway, which is the number a reader carries away from a PR.
describe("buildGateComment — an incomplete scan states that nothing was measured", () => {
  const incompleteGate: GateResult = {
    pass: false,
    policy: { minLevel: "L3" },
    failures: [{ code: "incomplete", message: "This scan is INCOMPLETE: no dimension could be scored." }],
    skipped: [],
  };
  const blind = () => report({ overallScore: 0, dimensions: [], incomplete: true });

  it("never prints a level/score grade in the title", () => {
    const c = buildGateComment(blind(), incompleteGate);
    expect(c.title).toBe("Could not be measured: no dimension could be scored");
    expect(c.title).not.toMatch(/L1|0\/100/);
  });

  it("says it in the summary too, and keeps failing closed", () => {
    const c = buildGateComment(blind(), incompleteGate);
    expect(c.summary).toContain("could not be measured");
    expect(c.summary).not.toContain("/100");
    // The verdict itself is unchanged: a gate must not certify a repository it could not read.
    expect(c.conclusion).toBe("failure");
  });

  it("is derived from the REPORT as well as the verdict — a legacy zero-dimension report counts", () => {
    const c = buildGateComment(blind(), { pass: true, policy: {}, failures: [], skipped: [] });
    expect(c.title).toBe("Could not be measured: no dimension could be scored");
  });
});
