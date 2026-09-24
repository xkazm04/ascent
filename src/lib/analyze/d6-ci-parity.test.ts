// D6 (Code Quality & Guardrails) reads the SAME CI files D3 already treats as a pipeline.
//
// Backlog develop-2026-09-17 row 2. D3 credits `.gitlab-ci.yml`, a `Jenkinsfile`, `.circleci/`,
// Azure/Travis/Bitbucket configs as "CI pipeline present", but D6's "enforced in CI" signal, its
// ratchet and its zero-warning gate only searched `.github/workflows/*`. A GitLab repo that runs
// `ruff check` in its pipeline read as gated on D3 and "configured, not enforced" on D6 for the same
// job. These tests pin the widened haystack, the git-hook label for `lefthook.yml`, and (as guards)
// that an Actions repo with none of these files scores exactly what it did.

import { describe, it, expect } from "vitest";
import { analyzeSignals } from "./index";
import type { RepoSnapshot, Signal } from "@/lib/types";

function repoSnap(files: { path: string; content?: string }[]): RepoSnapshot {
  return {
    meta: { owner: "o", name: "r", url: "", stars: 0, forks: 0, defaultBranch: "main" },
    tree: files.map((f) => ({ path: f.path, type: "blob" as const })),
    files: files
      .filter((f) => f.content !== undefined)
      .map((f) => ({ path: f.path, content: f.content as string, bytes: (f.content as string).length })),
    commits: [],
    truncated: false,
    coverage: 1,
  };
}
const d6 = (s: RepoSnapshot) => analyzeSignals(s, "2026-06-10T00:00:00Z").find((d) => d.id === "D6")!;
const find = (sigs: Signal[], re: RegExp) => sigs.find((x) => re.test(x.label));

const PYPROJECT = { path: "pyproject.toml", content: "[project]\nname = 'x'\n" };
const README = { path: "README.md", content: "# x" };

describe("D6 reads off-GitHub CI like D3 does", () => {
  it("a .gitlab-ci.yml running `ruff check` earns the full CI-enforcement signal and cites the file", () => {
    const out = d6(repoSnap([README, PYPROJECT, { path: ".gitlab-ci.yml", content: "lint:\n  script:\n    - ruff check .\n" }]));
    const sig = find(out.signals, /enforced in CI/);
    expect(sig?.label).toBe("Lint/format/type-check enforced in CI");
    expect(out.signalScore).toBe(20);
    expect(sig?.detail).toBe(".gitlab-ci.yml");
  });

  it("a Jenkinsfile lint stage tops up a configured linter by the same +5 an Actions job earns", () => {
    const base = [README, { path: "eslint.config.mjs", content: "export default []" }];
    const jenkins = d6(repoSnap([...base, { path: "Jenkinsfile", content: "pipeline { stages { stage('lint') { steps { sh 'npm run lint' } } } }" }]));
    const actions = d6(repoSnap([...base, { path: ".github/workflows/ci.yml", content: "jobs:\n  l:\n    steps:\n      - run: npm run lint\n" }]));
    expect(find(jenkins.signals, /also enforced in CI/)?.detail).toBe("Jenkinsfile");
    expect(jenkins.signalScore).toBe(actions.signalScore);
  });

  it("a CircleCI config's zero-warning clippy gate earns the guardrail AND the zero-warning signal", () => {
    const out = d6(repoSnap([README, { path: ".circleci/config.yml", content: "jobs:\n  lint:\n    steps:\n      - run: cargo clippy -- -D warnings\n" }]));
    expect(find(out.signals, /enforced in CI/)?.detail).toBe(".circleci/config.yml");
    expect(find(out.signals, /zero-warning policy/)).toBeDefined();
  });

  it("a ratchet run from a GitLab include cites that file, not the Actions wording", () => {
    const out = d6(repoSnap([README, PYPROJECT, { path: ".gitlab/ci/quality.yml", content: "ceiling:\n  script:\n    - python scripts/ruff_ignore_ceiling.py\n" }]));
    expect(find(out.signals, /Quality ratchet/)?.detail).toBe(".gitlab/ci/quality.yml");
  });

  it("a lefthook.yml gate is credited as a git hook, never as CI", () => {
    const out = d6(repoSnap([README, { path: "lefthook.yml", content: "pre-push:\n  commands:\n    types:\n      run: npx tsc --noEmit\n" }]));
    const sig = find(out.signals, /enforced in a git hook/);
    expect(sig?.label).toBe("Lint/format/type-check enforced in a git hook");
    expect(sig?.detail).toBe("lefthook.yml");
    expect(find(out.signals, /enforced in CI/)).toBeUndefined();
  });

  it("guard: an Actions workflow still wins the citation when off-GitHub CI also gates", () => {
    const out = d6(repoSnap([
      README,
      PYPROJECT,
      { path: ".gitlab-ci.yml", content: "lint:\n  script:\n    - ruff check .\n" },
      { path: ".github/workflows/ci.yml", content: "jobs:\n  l:\n    steps:\n      - run: ruff check .\n" },
    ]));
    expect(find(out.signals, /enforced in CI/)?.detail).toBe(".github/workflows/ci.yml");
  });

  it("guard: an Actions-only repo keeps its exact labels, details and score", () => {
    const out = d6(repoSnap([
      README,
      { path: "eslint.config.mjs", content: "export default []" },
      { path: ".github/workflows/ci.yml", content: "jobs:\n  l:\n    steps:\n      - run: npx eslint . --max-warnings 0\n      - run: node scripts/lint-ceiling.mjs\n" },
    ]));
    expect(out.signals.map((x) => [x.label, x.detail])).toEqual([
      ["Linter configured", "eslint.config.mjs"],
      ["Guardrails also enforced in CI", ".github/workflows/ci.yml"],
      ["Quality ratchet / debt ceiling enforced", "enforced in CI workflow"],
      ["Lint/type gate fails on warnings (zero-warning policy)", undefined],
    ]);
    expect(out.signalScore).toBe(45);
  });

  it("guard: guardrail words in a non-CI file (docs) do not count as enforcement", () => {
    const out = d6(repoSnap([README, { path: "docs/ci.md", content: "We should run ruff check and cargo clippy -D warnings someday." }]));
    expect(find(out.signals, /enforced in/)).toBeUndefined();
    expect(find(out.signals, /zero-warning/)).toBeUndefined();
  });

  it("guard: an off-GitHub pipeline with no guardrail command earns nothing new", () => {
    const out = d6(repoSnap([README, { path: ".gitlab-ci.yml", content: "test:\n  script:\n    - pytest\n" }]));
    expect(find(out.signals, /enforced in/)).toBeUndefined();
  });
});
