// INERT PATHS — the table, both directions. A false "inert" lands an unchecked change a build reads; a
// false "not inert" costs one lane its delivery. Every NOT row below is a case where the first would
// happen, which is why each is pinned.

import { describe, expect, it } from "vitest";
import { allInert, allIsolated, isInertPath, isIsolatedPath } from "@/lib/local/lane-inert";

describe("isInertPath — documentation and declarations", () => {
  it.each([
    "README.md",
    "CHANGELOG.md",
    "notes.txt",
    "guide.rst",
    "LICENSE",
    "LICENSE.md",
    "LICENSE-MIT",
    "CODEOWNERS",
    ".github/CODEOWNERS",
    "docs/CODEOWNERS",
    ".github/pull_request_template.md",
    ".github/PULL_REQUEST_TEMPLATE.md",
    ".github/PULL_REQUEST_TEMPLATE/feature.md",
    ".github/ISSUE_TEMPLATE/bug.yml",
    ".github/ISSUE_TEMPLATE/config.yml",
    "docs/AI_HARNESS.md",
    "docs/guide/intro.mdx",
    "docs/img/flow.svg",
    "docs/assets/logo.png",
    ".ai/manifest.yaml",
    ".ai/context/graph.json",
    ".ai/memory/README.md",
    ".claude/commands/review.md",
    "packages/ui/README.md",
  ])("%s is inert", (p) => expect(isInertPath(p)).toBe(true));

  it("normalises Windows separators and a leading ./", () => {
    expect(isInertPath("docs\\AI_HARNESS.md")).toBe(true);
    expect(isInertPath("./README.md")).toBe(true);
    expect(isInertPath(".github\\workflows\\ci.yml")).toBe(false);
  });
});

describe("isInertPath — NOT inert, even under an inert-looking directory", () => {
  it.each([
    // CI and hooks execute.
    [".github/workflows/x.yml", "CI definition"],
    [".github/workflows/README.md", "inside the CI directory"],
    [".github/actions/setup/action.yml", "a composite action CI calls"],
    [".github/dependabot.yml", "drives automation"],
    [".claude/settings.json", "registers hooks"],
    [".claude/settings.local.json", "registers hooks"],
    [".claude/hooks/notes.md", "a hooks directory"],
    [".husky/pre-commit", "a commit hook"],
    // Scripts and source, wherever they sit.
    ["docs/build.sh", "a script in docs"],
    ["docs/conf.py", "Sphinx config is Python"],
    [".ai/doctor.mjs", "executable conformance check"],
    ["LICENSE.js", "a script named like a licence"],
    ["Assets/Scripts/Player.cs", "Unity source"],
    ["Source/Game/Game.Build.cs", "Unreal build rules"],
    ["app/build.gradle.kts", "Gradle build"],
    // Manifests, lockfiles, build declarations with prose extensions.
    ["package.json", "package manifest"],
    ["pnpm-lock.yaml", "lockfile"],
    ["requirements.txt", "Python dependencies"],
    ["requirements-dev.txt", "Python dependencies"],
    ["CMakeLists.txt", "CMake build"],
    ["docs/package.json", "a docs site's manifest"],
    ["docs/_config.yml", "a docs site's build config"],
    // Tool configuration changes what the checks report.
    [".editorconfig", "format config"],
    [".markdownlint.json", "lint config"],
    [".ai/.prettierrc.json", "format config, even under .ai"],
    [".gitignore", "changes what tools see"],
    // Text inside a source, test, fixture or content tree is build/test input.
    ["src/foo.md", "embeddable from a source tree (include_str!, go:embed, ?raw)"],
    ["Assets/Resources/dialogue.txt", "Unity loads it at runtime"],
    ["Content/Readme.md", "Unreal content tree"],
    ["test/fixtures/sample.md", "a fixture a test asserts against"],
    ["testdata/input.txt", "Go test input"],
    ["content/blog/post.md", "site-generator frontmatter is validated at build"],
    ["src/app/page.mdx", "MDX outside docs/ compiles as JSX"],
    ["guide.mdx", "MDX outside docs/ compiles as JSX"],
    [".ai/notes.toml", "an .ai extension outside the declaration set"],
    ["docs/diagram.drawio", "an unknown docs extension"],
  ])("%s is NOT inert (%s)", (p) => expect(isInertPath(p)).toBe(false));

  it("refuses paths that are not plain relative file paths", () => {
    for (const p of ["", "   ", "docs/", "../README.md", "docs/../src/a.md", "docs//a.md"]) expect(isInertPath(p)).toBe(false);
  });
});

describe("allInert", () => {
  it("is false on an empty or absent list — an empty diff proves nothing", () => {
    expect(allInert([])).toBe(false);
    expect(allInert(undefined)).toBe(false);
    expect(allInert(null)).toBe(false);
  });

  it("is true only when EVERY path is inert", () => {
    expect(allInert(["README.md", ".github/pull_request_template.md", ".ai/manifest.yaml"])).toBe(true);
    expect(allInert(["README.md", ".github/workflows/ci.yml"])).toBe(false);
  });
});

describe("isIsolatedPath — new files nothing existing can reach", () => {
  it.each([
    [".ai/doctor.mjs", true],
    [".github/workflows/ai-conformance.yml", true],
    [".claude/skills/onboard/SKILL.md", true],
    [".claude/settings.json", false],
    [".claude/hooks/pre.mjs", false],
    [".ai/hooks/run.mjs", false],
    ["src/ai/doctor.ts", false],
    ["Assets/Scripts/New.cs", false],
    ["README.md", true],
  ])("%s → %s", (p, want) => expect(isIsolatedPath(p)).toBe(want));
  it("allIsolated is false on an empty list", () => expect(allIsolated([])).toBe(false));
});
