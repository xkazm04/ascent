import { describe, it, expect } from "vitest";
import {
  buildManifestData,
  serializeManifestYaml,
  buildMemorySeed,
  buildContextScaffold,
  buildDoctor,
  buildConformanceWiring,
  buildMaintain,
  buildFoundation,
} from "./index";
import { levelForScore } from "@/lib/maturity/model";
import type { ScanReport } from "@/lib/types";

function makeReport(lang = "TypeScript"): ScanReport {
  return {
    repo: {
      owner: "acme", name: "api", url: "https://github.com/acme/api", description: "Billing API",
      stars: 12, forks: 1, primaryLanguage: lang, defaultBranch: "main", headSha: "abc1234",
    },
    overallScore: 58, level: levelForScore(58), archetype: "team",
    adoptionScore: 55, rigorScore: 60,
    posture: { id: "ai-native", label: "AI-Native", blurb: "x" },
    aiUsage: { detected: true, commitFraction: 0.3, signals: [] },
    contributors: [], dimensions: [],
    headline: "h", strengths: [], risks: [], roadmap: [], discrepancies: [],
    confidence: 0.8, scannedAt: "2026-06-10T00:00:00.000Z",
    engine: { provider: "mock", model: "deterministic" },
  };
}

describe("ai-manifest", () => {
  it("declares capabilities as tool-neutral commands, never frameworks", () => {
    const d = buildManifestData(makeReport("TypeScript"));
    expect(d.schema).toBe("ai-manifest");
    expect(d.capabilities.test!.command).toBe("npm test");
    expect(d.capabilities.typecheck!.command).toContain("tsc");
    // The serialized form must not name the underlying tool as identity.
    const yaml = serializeManifestYaml(d);
    expect(yaml).not.toMatch(/vitest|jest|framework:/i);
    expect(yaml).toContain("schema: ai-manifest");
    expect(yaml).toContain("capabilities:");
  });

  it("is language-aware (commands follow the stack)", () => {
    expect(buildManifestData(makeReport("Python")).capabilities.test!.command).toBe("pytest");
    expect(buildManifestData(makeReport("Python")).capabilities.typecheck!.command).toBe("mypy .");
    expect(buildManifestData(makeReport("Go")).capabilities.test!.command).toBe("go test ./...");
  });

  it("encodes the shift-left control placement and pointer-based subsystems", () => {
    const d = buildManifestData(makeReport());
    // Fast checks pre-push; slow suites (full tests) + clean-room SAST in CI — tunable per repo.
    expect(d.controls.prePush).toEqual(["lint", "typecheck", "scan-secrets"]);
    expect(d.controls.ciHardPass).toEqual(["test", "sast", "merge-gate"]);
    expect(d.paths.memory).toBe(".ai/memory/");
    expect(d.paths.contextIndex).toBe(".ai/context-index.json");
  });

  it("records provenance for drift detection and carries a semver", () => {
    const d = buildManifestData(makeReport());
    expect(d.generatedFrom).toContain("package.json");
    expect(d.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(d.generatedAt).toBe("2026-06-10");
  });
});

describe("memory + context scaffolds", () => {
  it("seeds an append-only memory store with a worked example entry", () => {
    const files = buildMemorySeed(makeReport());
    const readme = files.find((f) => f.path === ".ai/memory/README.md")!;
    const seed = files.find((f) => f.path.endsWith("0001-adopt-ai-standard.md"))!;
    expect(readme.body).toContain("append-only");
    expect(readme.body).toContain("failed-approach"); // the tried-and-failed ledger
    expect(seed.body).toMatch(/^---\nid: 0001\n/);
    expect(seed.body).toContain("kind: decision");
  });

  it("scaffolds a CONTEXT template and a valid, freshness-aware index", () => {
    const files = buildContextScaffold(makeReport());
    const index = files.find((f) => f.path === ".ai/context-index.json")!;
    const parsed = JSON.parse(index.body);
    expect(parsed.modules[0].id).toBe("root");
    expect(parsed.modules[0].reconciledToSha).toBe("abc1234"); // freshness anchor from headSha
    expect(files.some((f) => f.path === "CONTEXT.md" && f.body.includes("Invariants"))).toBe(true);
  });
});

describe("doctor", () => {
  it("emits a zero-dependency Node script with no template-literal hazards", () => {
    const doc = buildDoctor();
    expect(doc.path).toBe(".ai/doctor.mjs");
    expect(doc.body.startsWith("#!/usr/bin/env node")).toBe(true);
    expect(doc.body).toContain("node:fs");
    expect(doc.body).toContain("Conformance:");
    // It must embed cleanly in a template literal: no backticks, no ${ } in the emitted source.
    expect(doc.body).not.toContain("`");
    expect(doc.body).not.toContain("${");
  });

  it("scopes path resolution to the paths: block so a like-named capability can't shadow it", () => {
    // Regression: a capability named `evals` once shadowed paths.evals via a naive first-match.
    expect(buildDoctor().body).toContain("scope to the paths: block");
  });
});

describe("conformance wiring (one script, two layers)", () => {
  it("emits a CI hard-pass that runs the same doctor command", () => {
    const w = buildConformanceWiring();
    expect(w.path).toBe(".github/workflows/ai-conformance.yml");
    expect(w.body).toContain("node .ai/doctor.mjs"); // the SAME command as pre-push
    expect(w.body).toContain("pull_request");
  });

  it("is branch-agnostic (no hard-coded default branch to get wrong)", () => {
    const w = buildConformanceWiring();
    expect(w.body).not.toMatch(/branches:\s*\[(main|master|trunk)\]/);
  });
});

describe("maintain (self-maintaining upkeep)", () => {
  it("emits a zero-dep script with check/note/touch and no embed hazards", () => {
    const m = buildMaintain();
    expect(m.path).toBe(".ai/maintain.mjs");
    expect(m.body.startsWith("#!/usr/bin/env node")).toBe(true);
    for (const sub of ["'check'", "'note'", "'touch'"]) expect(m.body).toContain(sub);
    expect(m.body).toContain("diff --name-only");
    expect(m.body).not.toContain("`");
    expect(m.body).not.toContain("${");
  });
});

describe("foundation", () => {
  it("bundles manifest, doctor, CI gate, maintain, memory and context in scaffold order", () => {
    const files = buildFoundation(makeReport());
    const paths = files.map((f) => f.path);
    expect(paths[0]).toBe(".ai/manifest.yaml"); // spine first
    expect(paths[1]).toBe(".ai/doctor.mjs"); // then the baseline check
    expect(paths).toContain(".github/workflows/ai-conformance.yml"); // its CI backstop
    expect(paths).toContain(".ai/maintain.mjs"); // self-maintaining upkeep
    expect(paths).toContain(".ai/memory/README.md");
    expect(paths).toContain(".ai/context-index.json");
  });
});
