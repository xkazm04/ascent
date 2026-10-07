// The corpus guard: a fingerprint over fixtures that exercise nothing pins nothing.
//
// Every case below is a branch of the scoring pipeline the rubric fingerprint claims to reach. The
// guard asserts each is witnessed by at least one fixture AND that every fixture is the only witness
// of at least one case, so a fixture cannot be deleted (or edited into a no-op) without the guard
// naming exactly which part of the pipeline just fell out of the pin.

import { beforeAll, describe, expect, it, vi } from "vitest";
import { SCORE_BLEND } from "./model";
import { RUBRIC_CORPUS } from "./rubric-corpus";
import { traceCorpus, type FixtureTrace } from "./rubric-fingerprint";
import { parseCommands } from "@/lib/analyze/guidance-graph";
import type { DimensionId } from "@/lib/types";

const DIMS: DimensionId[] = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9"];

const signal = (t: FixtureTrace, id: DimensionId) => t.phase.signals.find((s) => s.id === id);
const labels = (t: FixtureTrace, id: DimensionId) => (signal(t, id)?.signals ?? []).map((s) => s.label);
const dim = (t: FixtureTrace, id: DimensionId) => t.report.dimensions.find((d) => d.id === id);
/** A claim-scored dimension's score is clamp(signal + verified claim points). */
const claimPoints = (t: FixtureTrace, id: DimensionId) => {
  const d = dim(t, id);
  return d ? d.score - d.signalScore : 0;
};

const CORPUS_CASES: { name: string; holds: (t: FixtureTrace) => boolean }[] = [
  ...DIMS.map((id) => ({ name: `${id} signalScore > 0`, holds: (t: FixtureTrace) => (signal(t, id)?.signalScore ?? 0) > 0 })),
  { name: "D1 claimPoints > 0", holds: (t) => claimPoints(t, "D1") > 0 },
  { name: "D4 claimPoints > 0", holds: (t) => claimPoints(t, "D4") > 0 },
  { name: "scoreIntegrity.widenedDims non-empty", holds: (t) => (t.report.scoreIntegrity?.widenedDims.length ?? 0) > 0 },
  { name: "scoreIntegrity.widenCapped", holds: (t) => t.report.scoreIntegrity?.widenCapped === true },
  { name: "scoreIntegrity.d9Unmeasurable", holds: (t) => t.report.scoreIntegrity?.d9Unmeasurable === true },
  { name: "effectiveBlend < SCORE_BLEND", holds: (t) => (t.report.scoreIntegrity?.effectiveBlend ?? SCORE_BLEND) < SCORE_BLEND },
  { name: "WINDOW COVERAGE block in the user prompt", holds: (t) => t.user.includes("WINDOW COVERAGE (first-party") },
  { name: "fallback roadmap (empty model roadmap)", holds: (t) => t.fixture.assessment.roadmap.length === 0 && t.report.roadmap.length > 0 },
  { name: "off-platform review credited on D6", holds: (t) => labels(t, "D6").some((l) => l.includes("off-platform gate")) },
  { name: "D6 enforcement (quality ratchet)", holds: (t) => labels(t, "D6").some((l) => l.startsWith("Quality ratchet")) },
  { name: "guidance contradiction evidenced on D1", holds: (t) => (signal(t, "D1")?.facets ?? []).includes("contradiction") },
  { name: "derived-citation claim rejected", holds: (t) => (dim(t, "D1")?.evidence ?? []).some((e) => e.includes("(derived-citation)")) },
  { name: "platform fold observed", holds: (t) => t.phase.platformSignals?.source === "observed" },
  { name: "default-branch CI health folded on D3", holds: (t) => labels(t, "D3").some((l) => l.startsWith("Default-branch CI")) },
  {
    name: "D6 enforcement read from off-GitHub CI",
    holds: (t) =>
      (signal(t, "D6")?.signals ?? []).some((s) => s.label.includes("enforced in CI") && s.detail === ".gitlab-ci.yml"),
  },
  {
    name: "PR-head-only App credited (r22)",
    holds: (t) => (signal(t, "D2")?.signals ?? []).some((s) => s.detail?.includes("recent PR heads") ?? false),
  },
  // A contradiction the model CITED is evidence worth zero; the detector-side facet alone is no longer
  // unique to contradicting-guidance once dotnet-native's commands diverge too.
  { name: "model-cited contradiction confirmed on D1", holds: (t) => (dim(t, "D1")?.evidence ?? []).some((e) => e.startsWith("Model confirmed contradiction")) },
  {
    name: "D9 not measured on a blind reading: dropped, listed (r23)",
    holds: (t) => !dim(t, "D9") && (t.report.scoreIntegrity?.unmeasuredDims ?? []).includes("D9"),
  },
  {
    name: "unmeasured D9 owed no roadmap row (r23)",
    holds: (t) =>
      t.fixture.assessment.roadmap.some((r) => r.dimension === "D9") &&
      (t.report.scoreIntegrity?.unmeasuredDims ?? []).includes("D9") &&
      !t.report.roadmap.some((i) => i.dimension === "D9"),
  },
  {
    name: "D6 stack-native linter/formatter config (r23)",
    holds: (t) =>
      (signal(t, "D6")?.signals ?? []).some(
        (s) => /^(Linter|Formatter) configured$/.test(s.label) && /(^|\/)(\.globalconfig|\.clang-format|\.clang-tidy)$/.test(s.detail ?? ""),
      ),
  },
  {
    name: "D6 zero-warning gate read from a build file (r23)",
    holds: (t) => (signal(t, "D6")?.signals ?? []).some((s) => s.label.startsWith("Lint/type gate fails on warnings") && s.detail === "Directory.Build.props"),
  },
  { name: "D8 LLM-as-judge eval harness (r23)", holds: (t) => labels(t, "D8").some((l) => l.startsWith("AI-output eval harness (LLM-as-judge")) },
  { name: "D8 versioned agent guardrails (r23)", holds: (t) => labels(t, "D8").includes("AI contribution process (versioned agent guardrails)") },
  { name: "D8 task-card queue (r23)", holds: (t) => labels(t, "D8").includes("Structured task-card queue") },
  {
    name: "D5 single-file decision log (r23)",
    holds: (t) =>
      (signal(t, "D5")?.signals ?? []).some((s) => s.label === "Architecture Decision Records" && /(^|\/)(decisions|decision-log|adr)\.mdx?$/.test(s.detail ?? "")),
  },
  {
    name: "keyless scan excludes the GitHub-refutable D9 checks it skipped (r24)",
    holds: (t) =>
      ["security-policy", "sast", "dependency-updates"].every((id) =>
        t.phase.scoreInput.securityAssessment?.checks.some((c) => c.id === id && c.score === null && c.evidence.includes("had no token")),
      ),
  },
  {
    // The r22 command regex cut `dotnet test <path>` to `dotnet test`, so this divergence was agreement.
    name: "dotnet command keeps its path argument and diverges (r23)",
    holds: (t) =>
      (signal(t, "D1")?.facets ?? []).includes("contradiction") &&
      t.fixture.snapshot.files.some((f) => parseCommands(f.content).some((c) => /^dotnet (test|build) \S/.test(c.command))),
  },
];

/** The cases no fixture in `traces` witnesses. */
function uncovered(traces: readonly FixtureTrace[]): string[] {
  return CORPUS_CASES.filter((c) => !traces.some((t) => c.holds(t))).map((c) => c.name);
}

let traces: FixtureTrace[] = [];
beforeAll(async () => {
  vi.stubEnv("TECH_STACK_PROMPT", "");
  const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    traces = await traceCorpus(RUBRIC_CORPUS);
  } finally {
    quiet.mockRestore();
    vi.unstubAllEnvs();
  }
});

describe("RUBRIC_CORPUS coverage guard", () => {
  it("every case is witnessed by at least one fixture", () => {
    expect(traces).toHaveLength(RUBRIC_CORPUS.length);
    expect(uncovered(traces), "cases no fixture in RUBRIC_CORPUS reaches").toEqual([]);
  });

  it.each(RUBRIC_CORPUS.map((f) => [f.id]))("removing fixture %s uncovers a case, and the guard names it", (id) => {
    const lost = uncovered(traces.filter((t) => t.fixture.id !== id));
    expect(lost.length, `fixture "${id}" is not the only witness of any case: it pins nothing the others do not`).toBeGreaterThan(0);
  });

  it("fixture ids are unique", () => {
    expect(new Set(RUBRIC_CORPUS.map((f) => f.id)).size).toBe(RUBRIC_CORPUS.length);
  });
});
