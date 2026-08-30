// EVIDENCE HAS TO BE CHECKABLE — UAT `SAM-L1-01` (2026-08-10), recorded as an instant-trust-failure:
// "evidence lines are unsourced labels". A reader shown "Found MCP server config" beside a score has
// no way to verify it without re-deriving the detector's regex by hand, even though the detector
// walked the exact path that matched and then threw it away (`RepoIndex.has` returns a boolean).
//
// The other half is as load-bearing and easier to get wrong: several signals can fire from a
// FILE **or** from the manifest/workflow text blob. When the blob fired one, there is no path to
// cite, and citing a plausible one would be a fabrication in the one place the product is asking to
// be trusted. Those cases must stay unsourced.

import { describe, expect, it } from "vitest";
import { analyzeSignals } from "./index";
import { formatSignal } from "@/lib/types";
import type { RepoSnapshot, Signal } from "@/lib/types";

function snap(paths: string[], files: { path: string; content: string }[] = []): RepoSnapshot {
  return {
    meta: { owner: "o", name: "r", url: "", stars: 0, forks: 0, defaultBranch: "main", pushedAt: "2026-08-01T00:00:00Z" },
    tree: paths.map((path) => ({ path, type: "blob" as const })),
    files,
    commits: [{ message: "feat: x" }],
    truncated: false,
    coverage: 1,
  };
}

const sigs = (s: RepoSnapshot, dim: string): Signal[] =>
  analyzeSignals(s, "2026-08-05T00:00:00Z").find((d) => d.id === dim)!.signals;

/** The rendered `label (detail)` line, which is what actually reaches a report. */
const lineFor = (s: RepoSnapshot, dim: string, match: RegExp): string =>
  sigs(s, dim).map(formatSignal).find((x) => match.test(x)) ?? "";

// Under rubric r11 the five instruction-document formats stopped scoring as five "Found X" lines and
// became one award plus a coherence band (moonshot #15). The INVARIANT this file exists for is
// unchanged and still asserted below — a D1 evidence line names the file it was read from — only the
// label it is asserted against moved, and the r11 line names EVERY document rather than one.
describe("D1 evidence cites the file that produced it", () => {
  it("names the guidance documents rather than asserting guidance exists", () => {
    const line = lineFor(snap(["docs/CLAUDE.md"]), "D1", /Agent guidance present/);
    expect(line).toContain("docs/CLAUDE.md");
  });

  it("names every format it arbitrated, including a multi-file rules directory", () => {
    expect(lineFor(snap([".cursor/rules/style.mdc"]), "D1", /Agent guidance present/)).toContain(".cursor/rules/style.mdc");
    expect(lineFor(snap([".cursorrules"]), "D1", /Agent guidance present/)).toContain(".cursorrules");
  });

  it("names both paths of every coherence deduction — the number must re-trace to its evidence", () => {
    const s = snap(
      ["AGENTS.md", ".cursorrules"],
      [
        { path: "AGENTS.md", content: "# Guide\n\nRun `npm test` to test.\n" },
        { path: ".cursorrules", content: "Tests: run `npm run test:ci` here.\n" },
      ],
    );
    const line = lineFor(s, "D1", /Coherence −/);
    expect(line).toContain("AGENTS.md");
    expect(line).toContain(".cursorrules");
  });

  it("cites the file a GUIDANCE-QUALITY claim was read from — the claim is about that file's contents", () => {
    const s = snap(
      ["AGENTS.md"],
      [{ path: "AGENTS.md", content: "# Guide\n\nRun `npm test` to test and `npm run build` to build.\n" }],
    );
    const line = lineFor(s, "D1", /build\/test/i);
    // The tree's own casing, not a lower-cased copy: the citation has to be a path a reader can open.
    expect(line).toContain("AGENTS.md");
  });
});

describe("D5/D6/D9 presence evidence cites its path", () => {
  it("cites CONTRIBUTING.md, the changelog and the examples dir", () => {
    const s = snap(["CONTRIBUTING.md", "docs/CHANGELOG.md", "examples/basic/index.ts"]);
    expect(lineFor(s, "D5", /CONTRIBUTING/)).toContain("contributing.md");
    expect(lineFor(s, "D5", /Changelog/)).toContain("docs/changelog.md");
    expect(lineFor(s, "D5", /Examples directory/)).toContain("examples/basic/index.ts");
  });

  it("cites CODEOWNERS wherever it lives", () => {
    expect(lineFor(snap([".github/CODEOWNERS"]), "D6", /CODEOWNERS/)).toContain(".github/codeowners");
  });

  it("cites the SECURITY.md a policy signal was read from", () => {
    expect(lineFor(snap(["SECURITY.md"]), "D9", /SECURITY\.md policy/)).toContain("security.md");
  });

  it("cites the workflow behind a SAST signal", () => {
    const s = snap([".github/workflows/codeql-analysis.yml"]);
    expect(lineFor(s, "D9", /Static analysis \(SAST\)/)).toContain(".github/workflows/codeql-analysis.yml");
  });
});

describe("a signal fired by TEXT, not by a path, stays unsourced", () => {
  it("does not invent a file when SAST was detected in a workflow body", () => {
    // The workflow is named something else entirely; only its CONTENT mentions semgrep, so the
    // path-matching branch never fired and there is no file this claim can honestly point at.
    const s = snap(
      [".github/workflows/ci.yml"],
      [{ path: ".github/workflows/ci.yml", content: "jobs:\n  scan:\n    steps:\n      - run: semgrep --config auto\n" }],
    );
    const line = lineFor(s, "D9", /Static analysis \(SAST\)/);
    expect(line).toBe("Static analysis (SAST) in the pipeline"); // no " (…)" tail
  });

  it("does not invent a config file when the test framework came from the manifest", () => {
    const s = snap(
      ["package.json", "src/a.test.ts"],
      [{ path: "package.json", content: '{"devDependencies":{"vitest":"^4"}}' }],
    );
    const line = lineFor(s, "D2", /Test framework configured/);
    expect(line).toBe("Test framework configured");
  });

  it("cites the config file when one IS what fired it", () => {
    const s = snap(["vitest.config.ts", "src/a.test.ts"]);
    expect(lineFor(s, "D2", /Test framework configured/)).toContain("vitest.config.ts");
  });
});
