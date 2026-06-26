// Deterministic calibration guards for the dimensions added/extended in the 8→9 rubric
// change (D9 Supply Chain & Security; D2 advanced testing; D3 delivery-as-code). These pin
// the signal-layer behavior that the live benchmark (docs/CALIBRATION.md) validated against
// real repos, so a detector regex change can't silently drift the scores. Pure + offline.

import { describe, it, expect } from "vitest";
import { analyzeSignals } from "./index";
import type { DimensionSignals, RepoSnapshot } from "@/lib/types";

function snap(paths: string[], files: Record<string, string> = {}): RepoSnapshot {
  return {
    meta: { owner: "o", name: "r", url: "", stars: 0, forks: 0, defaultBranch: "main" },
    tree: paths.map((p) => ({ path: p, type: "blob" as const })),
    files: Object.entries(files).map(([path, content]) => ({ path, content, bytes: content.length })),
    commits: [],
    truncated: false,
    coverage: 1,
  };
}
const score = (sigs: DimensionSignals[], id: string) => sigs.find((d) => d.id === id)!.signalScore;

describe("rubric calibration — D9 Supply Chain & Security", () => {
  it("emits exactly 9 dimensions", () => {
    expect(analyzeSignals(snap(["README.md"]))).toHaveLength(9);
  });

  it("scores 0 on a repo with no security tooling", () => {
    expect(score(analyzeSignals(snap(["src/index.ts", "README.md"])), "D9")).toBe(0);
  });

  it("credits committed config the way the live react scan did (Dependabot + SECURITY.md ≈ 26)", () => {
    // Mirrors facebook/react: dependabot.yml (SCA 20) + SECURITY.md (policy 6) and nothing else.
    const s = snap([".github/dependabot.yml", "SECURITY.md"]);
    expect(score(analyzeSignals(s), "D9")).toBe(26);
  });

  it("discriminates: a full supply-chain posture scores well above a bare repo", () => {
    const secure = snap(
      [".github/workflows/codeql.yml", ".github/dependabot.yml", ".pre-commit-config.yaml", "Dockerfile", "SECURITY.md"],
      {
        ".github/workflows/codeql.yml":
          "uses: github/codeql-action/analyze\n- uses: aquasecurity/trivy-action\n- uses: anchore/sbom-action\n- uses: sigstore/cosign-installer",
        ".pre-commit-config.yaml": "repos:\n - repo: https://github.com/gitleaks/gitleaks",
      },
    );
    expect(score(analyzeSignals(secure), "D9")).toBeGreaterThan(70);
  });

  it("detects Renovate config variants (not just renovate.json)", () => {
    expect(score(analyzeSignals(snap([".github/renovate.json"])), "D9")).toBeGreaterThanOrEqual(20);
    expect(score(analyzeSignals(snap([".renovaterc"])), "D9")).toBeGreaterThanOrEqual(20);
  });
});

describe("rubric calibration — extended D2 / D3 signals", () => {
  it("D2 recognizes advanced testing (mutation/contract/perf/a11y/schema)", () => {
    const s = snap(["pacts/consumer.json", "stryker.conf.json", "k6/load.js", "tests/a11y.spec.ts"], {
      "stryker.conf.json": "{}",
    });
    const labels = analyzeSignals(s).find((d) => d.id === "D2")!.signals.map((x) => x.label).join(" | ");
    expect(labels).toMatch(/mutation/i);
    expect(labels).toMatch(/contract/i);
  });

  it("does NOT credit advanced signals from a concept-word in a plain source path (decoys)", () => {
    // maturity-model-scoring-engine #2: a filename naming a CONCEPT is not evidence of the PRACTICE.
    // `AccessibilityMenu.tsx` (no a11y tests) must not earn D2 a11y credit, and a generic `src/eval.ts`
    // (or a `json-eval` dep) must not earn the D8 eval/golden-test harness +30.
    const decoy = snap(["src/components/AccessibilityMenu.tsx", "src/eval.ts", "README.md"]);
    const d2 = analyzeSignals(decoy).find((d) => d.id === "D2")!.signals.map((x) => x.label).join(" | ");
    const d8 = analyzeSignals(decoy).find((d) => d.id === "D8")!.signals.map((x) => x.label).join(" | ");
    expect(d2).not.toMatch(/accessibility/i);
    expect(d8).not.toMatch(/golden-test harness/i);
  });

  it("D2 ranks a behaviorally-tested suite ABOVE an assertion-free one of the same size", () => {
    // Same number of test FILES (so the count/ratio base is identical) — only the sampled test
    // BODIES differ: one asserts behavior, the other only calls code. The vanity suite must score lower.
    const paths = Array.from({ length: 8 }, (_, i) => `tests/m${i}.test.ts`);
    const extra = ["src/app.ts", "vitest.config.ts"];
    const vanityFiles = Object.fromEntries(
      paths.map((p) => [p, "it('renders a', () => { render(A); });\nit('renders b', () => { render(B); });\n"]),
    );
    const realFiles = Object.fromEntries(
      paths.map((p) => [p, "it('adds', () => { expect(add(1,2)).toBe(3); });\nit('throws', () => { expect(() => boom()).toThrow(); });\n"]),
    );
    const vanity = analyzeSignals(snap([...paths, ...extra], vanityFiles));
    const real = analyzeSignals(snap([...paths, ...extra], realFiles));
    expect(score(real, "D2")).toBeGreaterThan(score(vanity, "D2"));
    const labels = (sigs: DimensionSignals[]) => sigs.find((d) => d.id === "D2")!.signals.map((s) => s.label).join(" | ");
    expect(labels(vanity)).toMatch(/assert nothing/i);
    expect(labels(real)).toMatch(/assert behavior/i);
  });

  it("D2 stays neutral when no test BODIES were sampled (paths only) — no false demotion", () => {
    // Tree has test files but the ingest budget fetched no test contents → can't judge → no adjustment.
    const labels = analyzeSignals(snap(["tests/a.test.ts", "tests/b.test.ts", "src/app.ts"]))
      .find((d) => d.id === "D2")!.signals.map((s) => s.label).join(" | ");
    expect(labels).not.toMatch(/assert nothing/i);
    expect(labels).not.toMatch(/assert behavior/i);
  });

  it("D3 recognizes delivery-as-code (GitOps / progressive delivery / migrations / policy)", () => {
    const s = snap([
      "clusters/prod/app.yaml",
      "prisma/migrations/0001_init/migration.sql",
      "policy/deny.rego",
    ]);
    const labels = analyzeSignals(s).find((d) => d.id === "D3")!.signals.map((x) => x.label).join(" | ");
    expect(labels).toMatch(/migration/i);
    expect(labels).toMatch(/policy-as-code/i);
  });
});
