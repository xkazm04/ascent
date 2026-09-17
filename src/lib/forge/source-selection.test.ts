// GitLab CI files are the same reserved fetch class as `.github/workflows/*`: D9's pipeline
// battery reads CONTENT, and `add()` would drop them once MAX_FILES is full.

import { describe, expect, it } from "vitest";
import { MAX_FILES, pickFilesToFetch } from "./source-selection";
import type { RepoFile } from "@/lib/types";

const blob = (path: string): RepoFile => ({ path, type: "blob" });

const EXACT_NAMES = [
  "readme.md", "readme", "readme.rst", "claude.md", "agents.md", "agent.md", ".cursorrules", ".windsurfrules",
  ".aider.conf.yml", "package.json", "pyproject.toml", "go.mod", "cargo.toml", "pom.xml", "build.gradle",
  "gemfile", "composer.json", "tsconfig.json", "eslint.config.js", "eslint.config.mjs", ".eslintrc.json",
  ".eslintrc.js", "biome.json", "ruff.toml", ".pre-commit-config.yaml", "contributing.md", "security.md",
  "changelog.md", "codeowners", ".github/codeowners", "docs/codeowners", ".github/copilot-instructions.md",
  ".github/dependabot.yml", "renovate.json", ".renovaterc.json", "dockerfile",
  "docker-compose.yml", "openapi.yaml", "openapi.json", "vercel.json",
  ".ai/manifest.yaml", ".ai/manifest.yml", ".ai/guardrails.yaml", ".ai/guardrails.yml",
];

function saturated(extra: string[]): RepoFile[] {
  const noise: RepoFile[] = EXACT_NAMES.map(blob);
  for (let i = 0; i < 8; i++) noise.push(blob(`src/module${i}.ts`));
  for (let i = 0; i < 6; i++) noise.push(blob(`tests/spec${i}.test.ts`));
  return [...noise, ...extra.map(blob)];
}

describe("pickFilesToFetch — GitLab CI files get a RESERVED quota so D9 can see pipelines", () => {
  it("fetches .gitlab-ci.yml even when high-signal files already fill MAX_FILES", () => {
    const picked = pickFilesToFetch(saturated([".gitlab-ci.yml"]));
    expect(picked).toContain(".gitlab-ci.yml");
    expect(picked.length).toBeGreaterThan(MAX_FILES);
  });

  it("accepts the .yaml spelling and nested copies", () => {
    const picked = pickFilesToFetch(saturated([".gitlab-ci.yaml", "packages/api/.gitlab-ci.yml"]));
    expect(picked).toContain(".gitlab-ci.yaml");
    expect(picked).toContain("packages/api/.gitlab-ci.yml");
  });

  it("reserves conventional .gitlab/ci include files", () => {
    const picked = pickFilesToFetch(saturated([".gitlab/ci/test.yml", ".gitlab/ci/deploy.yaml"]));
    expect(picked).toContain(".gitlab/ci/test.yml");
    expect(picked).toContain(".gitlab/ci/deploy.yaml");
  });

  it("does not spend the reserved quota on GitLab files that are not CI", () => {
    const picked = pickFilesToFetch(
      saturated([".gitlab/issue_templates/bug.md", ".gitlab/merge_request_templates/default.md"]),
    );
    expect(picked).not.toContain(".gitlab/issue_templates/bug.md");
    expect(picked).not.toContain(".gitlab/merge_request_templates/default.md");
  });

  it("still reserves GitHub workflows on their own quota (GitHub-only picks stay additive)", () => {
    const picked = pickFilesToFetch(
      saturated([".gitlab-ci.yml", ".github/workflows/ci.yml", ".github/workflows/release.yml"]),
    );
    expect(picked).toContain(".gitlab-ci.yml");
    expect(picked).toContain(".github/workflows/ci.yml");
    expect(picked).toContain(".github/workflows/release.yml");
  });

  it("ranks GitLab CI with the workflow tail, before memory", () => {
    const picked = pickFilesToFetch([
      blob("README.md"),
      blob(".gitlab-ci.yml"),
      blob(".github/workflows/ci.yml"),
      blob(".ai/memory/0001-a.md"),
    ]);
    expect(picked.indexOf(".gitlab-ci.yml")).toBeGreaterThan(picked.indexOf("README.md"));
    expect(picked.indexOf(".ai/memory/0001-a.md")).toBe(picked.length - 1);
  });

  it("still reads root GitLab CI on a sub-path scan", () => {
    const picked = pickFilesToFetch(
      [
        blob("README.md"),
        blob(".gitlab-ci.yml"),
        blob(".gitlab/ci/test.yml"),
        blob("packages/api/package.json"),
        blob("packages/api/src/x.ts"),
      ],
      "packages/api",
    );
    expect(picked).toContain(".gitlab-ci.yml");
    expect(picked).toContain(".gitlab/ci/test.yml");
  });
});
