// D6 (Code Quality & Guardrails) — PRESENCE vs ENFORCEMENT.
//
// Campaign evidence (21 runs, 2026-08): across two repos the loop added ESLint import-boundary rules,
// a blocking ruff ignore-ceiling ratchet, a blocking TypeScript suppression ratchet, exception lists
// and several gates wired into `check:ci`. D6 moved 66 → 68 on one repo and 81 → 81 on the other.
//
// The cause, confirmed by reading the detector: every artifact mapped onto a presence signal ALREADY
// awarded ("Linter configured", 20, fires on the config file the repo already had), and a ratchet —
// the only artifact of the set that actually blocks a build — mapped onto no signal at all. These
// tests pin the two enforcement signals that close it, and pin that they are ADDITIVE: a repo with
// neither scores exactly what it scored before.

import { describe, it, expect } from "vitest";
import { analyzeSignals } from "./index";
import type { CommitInfo, RepoSnapshot, Signal } from "@/lib/types";

function repoSnap(files: { path: string; content?: string }[], commits: CommitInfo[] = []): RepoSnapshot {
  return {
    meta: { owner: "o", name: "r", url: "", stars: 0, forks: 0, defaultBranch: "main" },
    tree: files.map((f) => ({ path: f.path, type: "blob" as const })),
    files: files
      .filter((f) => f.content !== undefined)
      .map((f) => ({ path: f.path, content: f.content as string, bytes: (f.content as string).length })),
    commits,
    truncated: false,
    coverage: 1,
  };
}
const d6 = (s: RepoSnapshot) => analyzeSignals(s, "2026-06-10T00:00:00Z").find((d) => d.id === "D6")!;
const labelText = (sigs: Signal[]) => sigs.map((x) => x.label).join(" | ");

/** A linter config and nothing that runs it — the "installed" end of the distinction. */
const configOnly = () =>
  repoSnap([
    { path: "eslint.config.mjs", content: "export default []" },
    { path: "package.json", content: JSON.stringify({ name: "x", devDependencies: { eslint: "^9" } }) },
    { path: "README.md", content: "# x" },
  ]);

describe("D6 presence vs enforcement", () => {
  it("a linter config with no enforcement scores BELOW one whose gate blocks the build", () => {
    const gated = repoSnap([
      { path: "eslint.config.mjs", content: "export default []" },
      {
        path: "package.json",
        content: JSON.stringify({
          name: "x",
          scripts: { lint: "eslint . --max-warnings 0", "check:ci": "npm run lint && npm run typecheck" },
          devDependencies: { eslint: "^9" },
        }),
      },
      { path: ".github/workflows/ci.yml", content: "jobs:\n  gate:\n    steps:\n      - run: npm run check:ci" },
      { path: "README.md", content: "# x" },
    ]);
    expect(d6(gated).signalScore).toBeGreaterThan(d6(configOnly()).signalScore);
    expect(labelText(d6(gated).signals)).toMatch(/fails on warnings/);
    expect(labelText(d6(configOnly()).signals)).not.toMatch(/fails on warnings/);
  });

  it("detects a suppression ratchet wired as a package.json script, and cites it", () => {
    const ratcheted = repoSnap([
      { path: "eslint.config.mjs", content: "export default []" },
      {
        path: "package.json",
        content: JSON.stringify({
          name: "x",
          scripts: {
            "check:ts-suppressions": "node scripts/ts-suppression-ceiling.mjs",
            "check:ci": "npm run lint && npm run check:ts-suppressions",
          },
        }),
      },
      { path: "README.md", content: "# x" },
    ]);
    const out = d6(ratcheted);
    expect(labelText(out.signals)).toMatch(/Quality ratchet \/ debt ceiling enforced/);
    expect(out.signals.find((x) => /ratchet/i.test(x.label))?.detail).toContain("check:ts-suppressions");
    expect(out.signalScore).toBe(d6(configOnly()).signalScore + 15);
  });

  it("detects a ruff ignore-ceiling ratchet run in CI, with no script entry at all", () => {
    const ci = repoSnap([
      { path: "pyproject.toml", content: "[tool.ruff]\nselect = ['E']" },
      {
        path: ".github/workflows/ci.yml",
        content: "jobs:\n  gate:\n    steps:\n      - run: python scripts/ruff_ignore_ceiling.py --ratchet",
      },
      { path: "README.md", content: "# x" },
    ]);
    expect(labelText(d6(ci).signals)).toMatch(/Quality ratchet \/ debt ceiling enforced/);
  });

  it("detects a checked-in lint baseline / betterer file", () => {
    for (const p of [".betterer.results", "eslint-baseline.json", "tools/type-ceiling.json"]) {
      const snap = repoSnap([{ path: p, content: "{}" }, { path: "README.md", content: "# x" }]);
      expect(labelText(d6(snap).signals)).toMatch(/Quality ratchet \/ debt ceiling enforced/);
    }
  });

  it("a repo with neither a ratchet nor a zero-warning gate is unchanged", () => {
    const out = d6(configOnly());
    expect(labelText(out.signals)).not.toMatch(/Quality ratchet|fails on warnings/);
    // "Linter configured" (20) alone — the exact pre-change score for this shape.
    expect(out.signalScore).toBe(20);
  });

  it("does not read a DEPENDENCY name as a gate (scripts are parsed, not regexed out of the manifest)", () => {
    const decoy = repoSnap([
      {
        path: "package.json",
        content: JSON.stringify({ name: "x", dependencies: { "@acme/budget-ratchet-ui": "^1", knip: "^5" } }),
      },
      { path: "README.md", content: "# x" },
    ]);
    expect(labelText(d6(decoy).signals)).not.toMatch(/Quality ratchet/);
  });

  it("survives an unparseable package.json without losing the rest of the dimension", () => {
    const broken = repoSnap([
      { path: "eslint.config.mjs", content: "export default []" },
      { path: "package.json", content: "{ not: json," },
      { path: "README.md", content: "# x" },
    ]);
    expect(d6(broken).signalScore).toBeGreaterThanOrEqual(20);
    expect(labelText(d6(broken).signals)).not.toMatch(/Quality ratchet/);
  });
});
