// D6 sees the stack-native forms of the linter, formatter and zero-warning awards, and stops crediting
// game-balance data as a quality ratchet.
//
// Game-repo investigation (2026-10-05): the D6 point table was keyed to JS conventions, so a Unity,
// Unreal or Gradle repo could not earn the linter award even with `.clang-tidy` or detekt committed,
// and an improvement loop that added one could never close the gap. Every test here runs BOTH ways:
// the form scores, and a repo without it (the three game repos today) still scores 0 on that row.

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

/** A game repo with source and no guardrails: the real state of all three repos on 2026-10-05. */
const GAME = [
  { path: "README.md", content: "# game" },
  { path: "Source/Game/Player.cpp" },
  { path: "Assets/Scripts/Ritual.cs" },
];

describe("D6 linter award sees stack-native configs", () => {
  it.each([
    ".clang-tidy",
    "detekt.yml",
    "config/detekt/detekt-config.yml",
    "detekt-config.yaml",
    ".ktlint",
    ".globalconfig",
    "src/stylecop.json",
    "Game.ruleset",
    ".swiftlint.yml",
    "checkstyle.xml",
    "config/checkstyle/rules.xml",
  ])("%s earns 'Linter configured' and is cited", (p) => {
    const out = d6(repoSnap([...GAME, { path: p }]));
    expect(find(out.signals, /^Linter configured$/)?.detail).toBe(p.toLowerCase());
  });

  it("a repo with none of them still scores 0 for the row", () => {
    const out = d6(repoSnap(GAME));
    expect(find(out.signals, /Linter configured/)).toBeUndefined();
    expect(out.signalScore).toBe(0);
  });

  it("a vendored library's config is that library's, not the repo's", () => {
    for (const p of ["ThirdParty/zlib/.clang-tidy", "vendor/lib/detekt.yml", "external/x/.swiftlint.yml"])
      expect(find(d6(repoSnap([...GAME, { path: p }])).signals, /Linter configured/)).toBeUndefined();
  });

  it("a ktlint/detekt plugin in a fetched root build.gradle.kts counts; the same file without one does not", () => {
    const kts = (body: string) => repoSnap([...GAME, { path: "build.gradle.kts", content: body }]);
    expect(find(d6(kts('plugins { id("org.jlleitschuh.gradle.ktlint") version "12.1.0" }')).signals, /Linter configured/)).toBeDefined();
    expect(find(d6(kts('plugins { id("io.gitlab.arturbosch.detekt") }')).signals, /Linter configured/)).toBeDefined();
    expect(find(d6(kts('plugins { kotlin("jvm") }')).signals, /Linter configured/)).toBeUndefined();
  });

  it("a JS repo keeps its existing citation when it also carries a native config", () => {
    const out = d6(repoSnap([...GAME, { path: "eslint.config.mjs" }, { path: ".clang-tidy" }]));
    expect(find(out.signals, /^Linter configured$/)?.detail).toBe("eslint.config.mjs");
  });
});

describe("D6 formatter award sees stack-native configs, once", () => {
  it.each([".clang-format", ".swift-format"])("%s earns 'Formatter configured'", (p) => {
    expect(find(d6(repoSnap([...GAME, { path: p }])).signals, /Formatter configured/)?.detail).toBe(p);
  });

  it(".clang-format beside .editorconfig is ONE award, citing the stronger file", () => {
    const out = d6(repoSnap([...GAME, { path: ".editorconfig" }, { path: ".clang-format" }]));
    expect(out.signals.filter((x) => /Formatter configured/.test(x.label))).toHaveLength(1);
    expect(find(out.signals, /Formatter configured/)?.detail).toBe(".clang-format");
    expect(out.signalScore).toBe(10);
  });

  it("no formatter config still scores nothing for the row", () => {
    expect(find(d6(repoSnap(GAME)).signals, /Formatter configured/)).toBeUndefined();
  });
});

describe("D6 zero-warning gate reads fetched build files", () => {
  const ZW = /fails on warnings/;
  it.each([
    ["Directory.Build.props", "<Project><PropertyGroup><TreatWarningsAsErrors>true</TreatWarningsAsErrors></PropertyGroup></Project>"],
    ["build.gradle.kts", "kotlin { compilerOptions { allWarningsAsErrors.set(true) } }"],
    ["build.gradle.kts", "tasks.withType<KotlinCompile> { kotlinOptions { allWarningsAsErrors = true } }"],
    ["build.gradle", "android { lintOptions { warningsAsErrors true } }"],
    ["Source/Game.Target.cs", "public GameTarget(TargetInfo t) : base(t) { bWarningsAsErrors = true; }"],
    ["Source/Game/Game.Build.cs", "DefaultWarningLevel = WarningLevel.Error;"],
  ])("%s with the switch earns the gate and cites the file", (path, content) => {
    expect(find(d6(repoSnap([...GAME, { path, content }])).signals, ZW)?.detail).toBe(path);
  });

  it("the same files without the switch, or with it commented out / false, earn nothing", () => {
    for (const [path, content] of [
      ["Directory.Build.props", "<Project><!-- <TreatWarningsAsErrors>true</TreatWarningsAsErrors> --></Project>"],
      ["Directory.Build.props", "<TreatWarningsAsErrors>false</TreatWarningsAsErrors>"],
      ["build.gradle.kts", "// allWarningsAsErrors = true\nkotlin { }"],
      ["Source/Game.Target.cs", "bWarningsAsErrors = false;"],
    ])
      expect(find(d6(repoSnap([...GAME, { path, content }])).signals, ZW)).toBeUndefined();
  });

  it("a CI zero-warning gate keeps its unsourced wording (byte-identical for existing repos)", () => {
    const out = d6(repoSnap([
      ...GAME,
      { path: ".github/workflows/ci.yml", content: "jobs:\n  l:\n    steps:\n      - run: npx eslint . --max-warnings 0\n" },
      { path: "Directory.Build.props", content: "<TreatWarningsAsErrors>true</TreatWarningsAsErrors>" },
    ]));
    expect(find(out.signals, ZW)?.detail).toBeUndefined();
  });
});

describe("D6 ratchet stops crediting game-balance data", () => {
  const RATCHET = /Quality ratchet/;
  it("firetv-shaped balance data and a balance audit script no longer earn the ratchet", () => {
    for (const p of [
      "deathride/evidence/phase2/ip-calibration/boss-hard-ceilings.json",
      "deathride/tools/audit-boss-ceilings.py",
      "data/ceilings.json",
      "Assets/Levels/Ceiling.prefab",
    ])
      expect(find(d6(repoSnap([...GAME, { path: p }])).signals, RATCHET), p).toBeUndefined();
  });

  it("a debt ceiling named for its debt still earns it, outside a data tree", () => {
    for (const p of ["tools/type-ceiling.json", "scripts/ts-suppression-ceiling.mjs", "scripts/ratchet.mjs", "tools/warnings-ceiling.json"])
      expect(find(d6(repoSnap([...GAME, { path: p }])).signals, RATCHET)?.detail, p).toBe(p);
  });
});
