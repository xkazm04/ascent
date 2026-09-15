// GUARD — the `.ai/` ingest additions and the memory QUARANTINE (moonshot #14, #13, #15).
//
// Three separate contracts share this file because they share one function:
//
//   1. `.ai/manifest.yaml` / `.ai/guardrails.yaml` are FETCHED (#13, delivered by this lane).
//      `aiStandard()` has read the manifest's content since it shipped, but nothing fetched it, so
//      the award was dead code. If this assertion goes red the readout goes silently null again.
//   2. The agent-guidance sample is 6 wide, not 4 (#15). A repo with five guidance files was
//      dropping the two most specific ones out of the guidance graph.
//   3. THE LOAD-BEARING ONE (#14): a `.ai/memory/NNNN-*.md` body is fetched into `memoryFiles` and
//      is NOT in `files`. `RepoSnapshot.files` is what `buildScanScoreInput` turns into the
//      assessment prompt, so "picked" and "prompted" must be different sets for this one family of
//      paths — they are untrusted, agent-written prose from a customer repository.
//
// FAILS BEFORE: `pickFilesToFetch` matched no `.ai/` path at all, `memoryPicks` /
// `quarantineMemoryFiles` did not exist, and the guidance sample was `.slice(0, 4)`.

import { describe, expect, it } from "vitest";
import {
  MAX_FILES,
  MAX_MEMORY_FILES,
  MEMORY_ENTRY_RE,
  memoryPicks,
  pickFilesToFetch,
  quarantineMemoryFiles,
} from "@/lib/github/source";
import type { FetchedFile, RepoFile } from "@/lib/types";

const blob = (path: string): RepoFile => ({ path, type: "blob" });
const blobs = (...paths: string[]): RepoFile[] => paths.map(blob);

const fetched = (path: string, content = "x"): FetchedFile => ({ path, content, bytes: content.length });

/**
 * A tree that genuinely saturates the 50-slot MAX_FILES budget: every high-signal exact name in BOTH
 * the sub-tree and the root, which is the shape (steps 1a + 1b of a sub-path scan on a polyglot
 * monorepo) that made the reserved-quota problem real for workflows in the first place.
 */
const EXACT_NAMES = [
  "readme.md", "package.json", "tsconfig.json", "pyproject.toml", "go.mod", "cargo.toml",
  "pom.xml", "build.gradle", "gemfile", "composer.json", "eslint.config.js", "biome.json",
  "ruff.toml", "contributing.md", "security.md", "changelog.md", "dockerfile",
  "docker-compose.yml", "openapi.yaml", "openapi.json", "vercel.json", "renovate.json",
  ".cursorrules", ".windsurfrules", ".aider.conf.yml", ".eslintrc.json", ".eslintrc.js",
  ".pre-commit-config.yaml",
];
const SUB_PATH = "packages/api";
const saturatedTree = (): RepoFile[] =>
  blobs(...EXACT_NAMES, ...EXACT_NAMES.map((n) => `${SUB_PATH}/${n}`));

describe("pickFilesToFetch — the `.ai/` declaration files (#13)", () => {
  it("fetches the manifest and the guardrails, in both yaml and yml spelling", () => {
    for (const name of [
      ".ai/manifest.yaml",
      ".ai/manifest.yml",
      ".ai/guardrails.yaml",
      ".ai/guardrails.yml",
    ]) {
      expect(pickFilesToFetch(blobs("README.md", name))).toContain(name);
    }
  });

  it("still fetches them on a sub-path scan — `.ai/` is a repo-level declaration", () => {
    const picks = pickFilesToFetch(
      blobs("README.md", ".ai/manifest.yaml", "packages/api/package.json", "packages/api/src/x.ts"),
      "packages/api",
    );
    expect(picks).toContain(".ai/manifest.yaml");
  });
});

describe("pickFilesToFetch — the guidance sample is six wide (#15)", () => {
  it("keeps five guidance files instead of dropping the two most specific", () => {
    const picks = pickFilesToFetch(
      blobs(
        "CLAUDE.md",
        "AGENTS.md",
        ".github/copilot-instructions.md",
        "packages/api/CLAUDE.md",
        "packages/web/AGENTS.md",
        "README.md",
      ),
    );
    for (const p of ["packages/api/CLAUDE.md", "packages/web/AGENTS.md"]) {
      expect(picks).toContain(p);
    }
  });
});

describe("memoryPicks — which entries a scan ingests (#14)", () => {
  const tree = [
    ".ai/memory/README.md",
    ".ai/memory/notes.md",
    ".ai/memory/0001-a.md",
    ".ai/memory/0002-b.md",
    ".ai/memory/0003-c.md",
  ];

  it("picks numbered entries newest-first", () => {
    expect(memoryPicks(tree)).toEqual([
      ".ai/memory/0003-c.md",
      ".ai/memory/0002-b.md",
      ".ai/memory/0001-a.md",
    ]);
  });

  it("never picks README.md or an unnumbered file", () => {
    const picked = memoryPicks(tree);
    expect(picked).not.toContain(".ai/memory/README.md");
    expect(picked).not.toContain(".ai/memory/notes.md");
    expect(MEMORY_ENTRY_RE.test(".ai/memory/README.md")).toBe(false);
  });

  it("caps at MAX_MEMORY_FILES, keeping the newest", () => {
    const many = Array.from({ length: 30 }, (_, i) => `.ai/memory/${String(i + 1).padStart(4, "0")}-e.md`);
    const picked = memoryPicks(many);
    expect(picked).toHaveLength(MAX_MEMORY_FILES);
    expect(picked[0]).toBe(".ai/memory/0030-e.md");
    expect(picked).not.toContain(".ai/memory/0001-e.md");
  });

  it("is deterministic when two entries share a number", () => {
    const both = [".ai/memory/0007-zebra.md", ".ai/memory/0007-alpha.md"];
    expect(memoryPicks(both)).toEqual([".ai/memory/0007-alpha.md", ".ai/memory/0007-zebra.md"]);
  });
});

describe("pickFilesToFetch — memory is a RESERVED quota (#14)", () => {
  it("yields memory entries even when the MAX_FILES budget is already saturated", () => {
    const tree = [...saturatedTree(), ...blobs(".ai/memory/0001-a.md", ".ai/memory/0002-b.md")];
    const picks = pickFilesToFetch(tree, SUB_PATH);
    // Precondition: the non-memory budget really is full, so this is a reservation, not a spare slot.
    expect(picks.filter((p) => !MEMORY_ENTRY_RE.test(p)).length).toBeGreaterThanOrEqual(MAX_FILES);
    expect(picks).toContain(".ai/memory/0001-a.md");
    expect(picks).toContain(".ai/memory/0002-b.md");
  });

  it("ranks memory LAST, after the workflows", () => {
    const picks = pickFilesToFetch(
      blobs("README.md", ".github/workflows/ci.yml", ".ai/memory/0001-a.md"),
    );
    expect(picks.indexOf(".ai/memory/0001-a.md")).toBe(picks.length - 1);
  });
});

describe("quarantineMemoryFiles — the boundary (#14)", () => {
  it("moves a memory body into memoryFiles and OUT of files", () => {
    const picks = ["README.md", ".ai/memory/0002-x.md"];
    const { files, memoryFiles } = quarantineMemoryFiles(
      [fetched("README.md"), fetched(".ai/memory/0002-x.md", "we tried X and it failed")],
      picks,
    );
    expect(files.map((f) => f.path)).toEqual(["README.md"]);
    expect(memoryFiles.map((f) => f.path)).toEqual([".ai/memory/0002-x.md"]);
    // The exact assertion that matters: the untrusted body is nowhere in the prompt-visible set.
    expect(JSON.stringify(files)).not.toContain("we tried X and it failed");
  });

  it("excludes memory picks from the coverage denominator, so the mirror cannot move coverage", () => {
    const picks = ["README.md", "package.json", ".ai/memory/0001-a.md", ".ai/memory/0002-b.md"];
    const { nonMemoryAttempted } = quarantineMemoryFiles(picks.map((p) => fetched(p)), picks);
    expect(nonMemoryAttempted).toBe(2);
  });

  it("leaves `.ai/memory/README.md` in files — it is documentation, not an entry", () => {
    const picks = [".ai/memory/README.md"];
    const { files, memoryFiles } = quarantineMemoryFiles([fetched(".ai/memory/README.md")], picks);
    expect(files).toHaveLength(1);
    expect(memoryFiles).toHaveLength(0);
  });
});
