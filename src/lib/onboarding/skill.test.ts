import { describe, it, expect } from "vitest";
import { buildOnboardingSkill } from "./skill";
import { selectTracks, WEAK_THRESHOLD } from "./tracks";
import { DIMENSIONS, levelForScore } from "@/lib/maturity/model";
import type { DimensionId, ScanReport } from "@/lib/types";

/** Build a minimal-but-valid ScanReport with the given per-dimension blended scores. */
function makeReport(scores: Partial<Record<DimensionId, number>>, overall = 58): ScanReport {
  const dimensions = DIMENSIONS.map((d) => ({
    id: d.id,
    name: d.name,
    weight: d.weight,
    score: scores[d.id] ?? 80,
    signalScore: scores[d.id] ?? 80,
    llmScore: scores[d.id] ?? 80,
    summary: `${d.name} summary`,
    evidence: [],
    strengths: [`${d.id} strength`],
    gaps: [`${d.id} gap one`, `${d.id} gap two`],
  }));
  return {
    repo: {
      owner: "acme",
      name: "api",
      url: "https://github.com/acme/api",
      description: "Billing API",
      stars: 12,
      forks: 1,
      primaryLanguage: "TypeScript",
      defaultBranch: "main",
    },
    overallScore: overall,
    level: levelForScore(overall),
    archetype: "team",
    adoptionScore: 55,
    rigorScore: 60,
    posture: { id: "ai-native", label: "AI-Native", blurb: "Adopting AI with the rigor to ship it." },
    aiUsage: { detected: true, commitFraction: 0.3, signals: ["Co-Authored-By: Claude"] },
    contributors: [],
    dimensions,
    headline: "acme/api is at L3 — Augmented",
    strengths: ["Solid test suite", "CI on every PR"],
    risks: ["No secret scanning"],
    roadmap: [],
    discrepancies: [],
    confidence: 0.8,
    scannedAt: "2026-06-10T00:00:00.000Z",
    engine: { provider: "mock", model: "deterministic" },
  };
}

describe("buildOnboardingSkill", () => {
  it("bakes the scan headline facts into the frontmatter and state section", () => {
    const skill = buildOnboardingSkill(makeReport({}));
    expect(skill.name).toBe("ascent-onboard");
    expect(skill.path).toBe(".claude/skills/ascent-onboard/SKILL.md");
    expect(skill.body).toMatch(/^---\nname: ascent-onboard\n/);
    expect(skill.body).toContain("acme/api");
    expect(skill.body).toContain("L3"); // baked level
    expect(skill.body).toContain("58/100"); // baked overall score
  });

  it("turns only weak dimensions (< threshold) into tracks by default", () => {
    const report = makeReport({ D4: 40, D8: 50, D9: 60, D2: 88, D1: 90 });
    const tracks = selectTracks(report);
    const ids = tracks.map((t) => t.dimId);
    expect(ids).toContain("D4");
    expect(ids).toContain("D8");
    expect(ids).toContain("D9");
    expect(ids).not.toContain("D2"); // strong → not a track
    expect(ids).not.toContain("D1");
    expect(tracks.every((t) => t.score < WEAK_THRESHOLD)).toBe(true);
  });

  it("honors an explicit include set — even a refinement on a strong dimension", () => {
    const report = makeReport({ D2: 88 });
    const tracks = selectTracks(report, { include: ["D2"] });
    expect(tracks.map((t) => t.dimId)).toEqual(["D2"]);
    expect(tracks[0]!.score).toBe(88);
  });

  it("orders tracks by leverage (impact weighted, then ease)", () => {
    // D5 (medium/low default) should outrank nothing higher; D4 (high/medium) outranks D5.
    const report = makeReport({ D4: 40, D5: 40 });
    const tracks = selectTracks(report);
    expect(tracks[0]!.dimId).toBe("D4");
  });

  it("renders the two-layer control model for each track (pre-push primary, CI backstop)", () => {
    const skill = buildOnboardingSkill(makeReport({ D9: 50 }), { include: ["D9"] });
    expect(skill.body).toContain("Pre-push checklist");
    expect(skill.body).toContain("CI hard passes");
    // The D9 control thesis: secrets are caught before they leave the machine.
    expect(skill.body).toContain("before it leaves the machine");
    expect(skill.body).toContain("SAST on the full tree");
  });

  it("anchors each track on the real control, not a doc placeholder", () => {
    const skill = buildOnboardingSkill(makeReport({ D9: 50 }), { include: ["D9"] });
    // The deliverable is the actual control to create/extend (gitleaks hook + CodeQL), not SECURITY.md.
    expect(skill.body).toContain("gitleaks hook (pre-commit)");
    expect(skill.body).toContain("codeql.yml");
    expect(skill.body).not.toContain("SECURITY.md");
  });

  it("makes the D2/D3 deliverables language-aware", () => {
    const py = makeReport({ D2: 50, D3: 50 });
    py.repo.primaryLanguage = "Python";
    const pyTracks = selectTracks(py, { include: ["D2", "D3"] });
    expect(pyTracks.find((t) => t.dimId === "D2")!.deliverable.path).toContain("pytest --cov");
    const pyD3 = pyTracks.find((t) => t.dimId === "D3")!.deliverable.path;
    expect(pyD3).toContain("setup-python");
    expect(pyD3).toContain("pytest");

    const ts = makeReport({ D2: 50 });
    ts.repo.primaryLanguage = "TypeScript";
    expect(selectTracks(ts, { include: ["D2"] })[0]!.deliverable.path).toContain("vitest --coverage");

    const go = makeReport({ D3: 50 });
    go.repo.primaryLanguage = "Go";
    expect(selectTracks(go, { include: ["D3"] })[0]!.deliverable.path).toContain("go test");
  });

  it("falls back to the generic deliverable for an unknown stack", () => {
    const r = makeReport({ D2: 50 });
    r.repo.primaryLanguage = undefined;
    const d2 = selectTracks(r, { include: ["D2"] })[0]!.deliverable.path;
    expect(d2).toContain("coverage config"); // the static, language-agnostic text
    expect(d2).not.toContain("vitest");
  });

  it("includes the control-model preamble and the interactive run protocol", () => {
    const skill = buildOnboardingSkill(makeReport({ D4: 40 }));
    expect(skill.body).toContain("push controls LEFT of CI");
    expect(skill.body).toContain("multiselect");
    expect(skill.body).toContain(".ai/maintain.mjs note"); // progress logs into .ai/memory, not a 2nd ledger
    expect(skill.body).not.toContain(".ascent/onboarding-progress.md"); // the old, reconciled-away ledger
    expect(skill.body).toContain("re-scan"); // close-the-loop
  });

  it("installs the .ai/ foundation as Step 0, before the dimension tracks", () => {
    const body = buildOnboardingSkill(makeReport({ D4: 40 })).body;
    expect(body).toContain("Step 0 — Lay the foundation");
    expect(body).toContain(".ai/manifest.yaml");
    expect(body).toContain(".ai/doctor.mjs");
    expect(body).toContain("node .ai/doctor.mjs");
    // Foundation precedes the tracks menu.
    expect(body.indexOf("Step 0")).toBeLessThan(body.indexOf("Tracks (highest leverage first)"));
  });

  it("celebrates strengths and emits no tracks when the repo is already strong", () => {
    const skill = buildOnboardingSkill(makeReport({}, 90)); // all dims default 80 → strong
    expect(selectTracks(makeReport({}, 90))).toHaveLength(0);
    expect(skill.body).toContain("already broadly");
  });

  it("renders a definition-of-done checklist per track", () => {
    const skill = buildOnboardingSkill(makeReport({ D8: 45 }), { include: ["D8"] });
    expect(skill.body).toContain("Definition of done");
    expect(skill.body).toContain("golden test"); // D8 DoD leads with the local eval run
  });
});
