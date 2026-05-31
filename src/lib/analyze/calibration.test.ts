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
