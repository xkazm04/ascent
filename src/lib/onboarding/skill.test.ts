import { describe, it, expect } from "vitest";
import { buildOnboardingSkill } from "./skill";
import { selectTracks, WEAK_THRESHOLD } from "./tracks";
import { DIMENSIONS, levelForScore } from "@/lib/maturity/model";
import type { DimensionId, ScanReport, TechStack } from "@/lib/types";

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
    evidence: [`${d.id} observed evidence`],
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

// ── Stack-aware tracks ────────────────────────────────────────────────────────────────────────────
// The defect these pin: the per-dimension control matrix is static, so two repos with the SAME weak
// dimensions and the SAME primary language used to download BYTE-IDENTICAL instructions even when one
// was a Next.js app and the other a Terraform module set. `report.techStack` carried the answer and was
// never read. Also pinned: the graceful degrade when techStack is absent (older persisted rows had a
// null Scan.techStackJson) — that path must render exactly the pre-stack track, and must never throw.

/** Attach a detected tech stack to a report fixture. */
function withStack(report: ScanReport, stack: Partial<TechStack>): ScanReport {
  report.techStack = { languages: [], frameworks: [], roles: [], confidence: 0.8, ...stack } as TechStack;
  return report;
}

describe("stack-aware tracks", () => {
  it("produces DIVERGENT track content for two same-dimension, same-language repos on different stacks", () => {
    const dims: Partial<Record<DimensionId, number>> = { D2: 45, D3: 45, D9: 45 };
    const nextApp = withStack(makeReport(dims), {
      languages: ["TypeScript"],
      frameworks: ["Next.js", "React"],
      roles: ["frontend", "backend"],
    });
    const infra = withStack(makeReport(dims), {
      languages: ["TypeScript"],
      frameworks: ["Terraform", "Kubernetes"],
      roles: ["infra"],
    });

    const a = buildOnboardingSkill(nextApp).body;
    const b = buildOnboardingSkill(infra).body;

    expect(a).not.toBe(b); // the headline claim: the same rubric verdict no longer yields the same file
    // Each repo sees its own stack's controls…
    expect(a).toContain("next build");
    expect(a).toContain("server actions");
    expect(b).toContain("terraform validate");
    expect(b).toContain("tfsec/checkov");
    // …and NOT the other's.
    expect(a).not.toContain("tfsec");
    expect(b).not.toContain("next build");
  });

  it("specializes the D2 coverage deliverable on the FRAMEWORK, not just the language", () => {
    const dims: Partial<Record<DimensionId, number>> = { D2: 45 };
    const nextD2 = selectTracks(withStack(makeReport(dims), { languages: ["TypeScript"], frameworks: ["Next.js"] }), {
      include: ["D2"],
    })[0]!.deliverable.path;
    const plainD2 = selectTracks(makeReport(dims), { include: ["D2"] })[0]!.deliverable.path;

    expect(nextD2).toContain("app/ route handlers");
    expect(plainD2).toContain("vitest --coverage thresholds in vitest.config"); // the language-only recipe
    expect(nextD2).not.toBe(plainD2);
  });

  it("gives a repo beyond the five known languages REAL commands instead of guaranteed-warn placeholders", () => {
    const ruby = makeReport({ D3: 45 });
    ruby.repo.primaryLanguage = "Ruby";
    const d3 = selectTracks(withStack(ruby, { languages: ["Ruby"], frameworks: ["Rails"] }), { include: ["D3"] })[0]!;
    expect(d3.deliverable.path).toContain("ruby/setup-ruby");
    expect(d3.deliverable.path).toContain("bundle install");
    expect(d3.deliverable.path).toContain("bundle exec rspec");
    // The placeholders the generated doctor warns about are gone.
    expect(d3.deliverable.path).not.toContain("<run tests>");
    expect(d3.deliverable.path).not.toContain("<install deps>");
  });

  it("recovers commands from techStack.languages when the GitHub primary language is not buildable", () => {
    // A Django repo GitHub labels "HTML" (templates outweigh .py) — the old path emitted placeholders.
    const r = makeReport({ D3: 45 });
    r.repo.primaryLanguage = "HTML";
    const d3 = selectTracks(withStack(r, { languages: ["HTML", "Python"], frameworks: ["Django"], roles: ["backend"] }), {
      include: ["D3"],
    })[0]!;
    expect(d3.deliverable.path).toContain("setup-python");
    expect(d3.deliverable.path).toContain("pytest");
    expect(d3.deliverable.path).toContain("python manage.py check --deploy"); // the Django build/verify step
  });

  it("surfaces per-dimension scan evidence under the track's why", () => {
    const body = buildOnboardingSkill(makeReport({ D4: 40 }), { include: ["D4"] }).body;
    expect(body).toContain("What the scan observed");
    expect(body).toContain("D4 observed evidence");
    // Evidence sits under the rationale, not replacing it.
    expect(body.indexOf("Why (from the scan)")).toBeLessThan(body.indexOf("What the scan observed"));
  });

  it("degrades to today's behavior — no stack section, no throw — when techStack is absent (older rows)", () => {
    const noStack = makeReport({ D2: 45, D3: 45, D9: 45 });
    expect(noStack.techStack).toBeUndefined();
    const body = buildOnboardingSkill(noStack).body;
    expect(body).not.toContain("Tuned to this stack");
    // Still language-aware from repo.primaryLanguage alone (TypeScript), exactly as before.
    expect(body).toContain("vitest --coverage thresholds in vitest.config");
    expect(selectTracks(noStack).every((t) => t.stackNotes.length === 0)).toBe(true);
  });

  it("never throws on a malformed/partial persisted techStack blob", () => {
    const r = makeReport({ D2: 45 });
    // Simulate a hand-edited / half-written JSON blob: wrong types where arrays are expected.
    r.techStack = { languages: null, frameworks: undefined, roles: 7 } as unknown as TechStack;
    expect(() => buildOnboardingSkill(r)).not.toThrow();
    expect(selectTracks(r)[0]!.stackNotes).toEqual([]);
  });
});
