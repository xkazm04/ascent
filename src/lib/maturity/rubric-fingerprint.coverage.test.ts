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
