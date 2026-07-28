// Regression tests for two scan-and-decide fixes in the signal layer:
//   #5 (60dd3afd) — D7's recency bonus must guard a malformed pushedAt (and surface a note)
//                   instead of silently dropping the bonus via a NaN comparison.
//   #9 (4fd114f9) — AI/bot commit attribution is single-sourced; lock in the counts that
//                   detectAiUsage and computeContributors derive from the shared predicate.

import { describe, it, expect } from "vitest";
import { analyzeSignals, detectAiUsage, computeContributors, classifyArchetype } from "./index";
import { applyPrSignals } from "./pulls";
import { overallScoreFor } from "@/lib/maturity/model";
import type { CommitInfo, PrStats, RepoMeta, RepoSnapshot, Signal } from "@/lib/types";

function snap(meta: Partial<RepoMeta>, commits: CommitInfo[] = []): RepoSnapshot {
  return {
    meta: { owner: "o", name: "r", url: "", stars: 0, forks: 0, defaultBranch: "main", ...meta },
    tree: [{ path: "README.md", type: "blob" }],
    files: [],
    commits,
    truncated: false,
    coverage: 1,
  };
}
const d7 = (s: RepoSnapshot, now: string) => analyzeSignals(s, now).find((d) => d.id === "D7")!;
const labelText = (sigs: Signal[]) => sigs.map((x) => x.label).join(" | ");

describe("D7 recency bonus — pushedAt NaN guard (#5)", () => {
  const commits: CommitInfo[] = [{ message: "feat: x" }];

  it("awards 'Actively maintained' for a recent, valid pushedAt", () => {
    const out = d7(snap({ pushedAt: "2026-05-30T00:00:00Z" }, commits), "2026-06-02T00:00:00Z");
    expect(labelText(out.signals)).toMatch(/Actively maintained/);
  });

  it("notes an unreadable pushedAt instead of silently voiding the bonus", () => {
    const out = d7(snap({ pushedAt: "not-a-date" }, commits), "2026-06-02T00:00:00Z");
    expect(labelText(out.signals)).toMatch(/unreadable/i);
    expect(labelText(out.signals)).not.toMatch(/Actively maintained/);
  });

  it("omits the bonus for a stale (but valid) pushedAt without erroring", () => {
    const out = d7(snap({ pushedAt: "2024-01-01T00:00:00Z" }, commits), "2026-06-02T00:00:00Z");
    expect(labelText(out.signals)).not.toMatch(/Actively maintained/);
    expect(labelText(out.signals)).not.toMatch(/unreadable/i);
  });
});

describe("AI-attribution single source (#9)", () => {
  const commits: CommitInfo[] = [
    { message: "feat: a\n\nCo-Authored-By: Claude <noreply@anthropic.com>", authorLogin: "alice" },
    { message: "fix: b", authorLogin: "dependabot[bot]" },
    { message: "chore: c", authorLogin: "bob" },
  ];

  it("detectAiUsage counts both co-author trailers and [bot] authors", () => {
    const u = detectAiUsage(snap({}, commits));
    expect(u.detected).toBe(true);
    expect(u.commitFraction).toBe(0.67); // 2 of 3, rounded to 2dp
  });

  it("computeContributors attributes AI commits per author from the same predicate", () => {
    const cs = computeContributors(snap({}, commits));
    expect(cs.find((c) => c.login === "alice")!.aiCommits).toBe(1);
    expect(cs.find((c) => c.login === "dependabot[bot]")!.aiCommits).toBe(1);
    expect(cs.find((c) => c.login === "bob")!.aiCommits).toBe(0);
  });

  it("reports no AI usage on a fully human history", () => {
    const u = detectAiUsage(snap({}, [{ message: "fix: y", authorLogin: "carol" }]));
    expect(u.detected).toBe(false);
    expect(u.commitFraction).toBe(0);
  });
});

describe(".ai/ standard scoring — verified, not present (Goodhart guard)", () => {
  function fileSnap(files: { path: string; content?: string }[]): RepoSnapshot {
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
  const score = (s: RepoSnapshot, id: "D1" | "D8") =>
    analyzeSignals(s, "2026-06-10T00:00:00Z").find((d) => d.id === id)!.signalScore;

  const MANIFEST =
    "schema: ai-manifest\nschemaVersion: 0.1.0\ncapabilities:\n  test: { command: \"npm test\", verified: false }\ncontrols:\n  prePush: [test]\n";
  const bare = fileSnap([{ path: "README.md", content: "# r" }]);
  const scaffoldOnly = fileSnap([
    { path: ".ai/manifest.yaml", content: MANIFEST },
    { path: ".ai/doctor.mjs", content: "// doctor" },
    { path: ".ai/memory/0001-adopt.md", content: "seed" },
  ]);
  const wiredAndUsed = fileSnap([
    { path: ".ai/manifest.yaml", content: MANIFEST },
    { path: ".ai/doctor.mjs", content: "// doctor" },
    { path: ".github/workflows/ai-conformance.yml", content: "run: node .ai/doctor.mjs" },
    { path: ".ai/memory/0001-adopt.md", content: "seed" },
    { path: ".ai/memory/0002-gotcha.md", content: "a learned fact" },
  ]);

  it("the manifest contributes machine-readable-guidance signal to D1", () => {
    expect(score(scaffoldOnly, "D1")).toBeGreaterThan(score(bare, "D1"));
  });

  it("rewards a WIRED, USED standard far above a dropped-in empty scaffold", () => {
    expect(score(wiredAndUsed, "D8")).toBeGreaterThan(score(scaffoldOnly, "D8"));
    expect(score(scaffoldOnly, "D8")).toBeGreaterThan(score(bare, "D8")); // a little, not a lot
  });

  it("labels the doctor as unwired until it is in CI or a hook", () => {
    const labels = (s: RepoSnapshot) =>
      analyzeSignals(s, "2026-06-10T00:00:00Z").find((d) => d.id === "D8")!.signals.map((x) => x.label).join(" | ");
    expect(labels(scaffoldOnly)).toMatch(/not yet wired/i);
    expect(labels(wiredAndUsed)).toMatch(/wired into CI\/hook/i);
  });
});

// Reference-scan audit fixes: the deterministic layer was GitHub-Actions-centric, so world-class repos
// whose CI/review run OFF GitHub (golang on Gerrit, rust on bors) scored a false 0 on D3, and D6 missed
// guardrails enforced inline in CI (the Rust/Go norm). These lock in the corrected detection.
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
const dimOf = (s: RepoSnapshot, id: string) => analyzeSignals(s, "2026-06-10T00:00:00Z").find((d) => d.id === id)!;

describe("D3 off-GitHub CI detection (P0-1)", () => {
  it("credits an off-GitHub CI gate from Gerrit review trailers (was a false 'No CI')", () => {
    const gerrit = repoSnap(
      [{ path: "Makefile", content: "test:\n\tgo test ./..." }, { path: "README.md", content: "# go" }],
      [{ message: "runtime: fix scheduler\n\nChange-Id: I0123456789abcdef0123\nReviewed-on: https://go-review.googlesource.com/c/go/+/1" }],
    );
    const d3 = dimOf(gerrit, "D3");
    expect(labelText(d3.signals)).toMatch(/Off-GitHub CI detected \(Gerrit\)/);
    expect(labelText(d3.signals)).toMatch(/CI runs tests/); // inferred from the Makefile the gate runs
    expect(d3.signalScore).toBeGreaterThanOrEqual(35);
  });

  it("credits a bors/merge-queue gate from a bors.toml + r=<reviewer> trailer", () => {
    const bors = repoSnap(
      [{ path: "bors.toml", content: "status = ['ci']" }, { path: "Cargo.toml", content: "[package]" }],
      [{ message: "Auto merge of #123 - fix: thing, r=alice" }],
    );
    expect(labelText(dimOf(bors, "D3").signals)).toMatch(/Off-GitHub CI detected \(bors/);
  });

  it("still reports 'No CI pipeline detected' with neither GHA nor off-GitHub markers", () => {
    const bare = repoSnap([{ path: "README.md", content: "# r" }], [{ message: "initial commit" }]);
    expect(labelText(dimOf(bare, "D3").signals)).toMatch(/No CI pipeline detected/);
  });

  it("leaves GHA repos byte-identical (GitHub Actions still wins the base credit)", () => {
    const gha = repoSnap([{ path: ".github/workflows/ci.yml", content: "jobs:\n  t:\n    steps:\n      - run: go test ./..." }]);
    const labels = labelText(dimOf(gha, "D3").signals);
    expect(labels).toMatch(/GitHub Actions CI present/);
    expect(labels).not.toMatch(/Off-GitHub/);
  });
});

describe("D6 CI-inline guardrails (P0-2)", () => {
  it("credits lint/format enforced inline in CI even with no standalone config file", () => {
    const rust = repoSnap([
      { path: ".github/workflows/ci.yml", content: "jobs:\n  lint:\n    steps:\n      - run: cargo clippy --all -- -D warnings\n      - run: cargo fmt --all --check" },
      { path: "Cargo.toml", content: "[package]\nname = 'x'" },
      { path: "README.md", content: "# x" },
    ]);
    const d6 = dimOf(rust, "D6");
    expect(labelText(d6.signals)).toMatch(/enforced in CI/);
    expect(d6.signalScore).toBeGreaterThanOrEqual(20);
  });

  it("does not credit CI guardrails when the workflow runs no lint/format/type step", () => {
    const noLint = repoSnap([
      { path: ".github/workflows/ci.yml", content: "jobs:\n  t:\n    steps:\n      - run: go test ./..." },
      { path: "go.mod", content: "module x" },
    ]);
    expect(labelText(dimOf(noLint, "D6").signals)).not.toMatch(/enforced in CI/);
  });
});

describe("D6 off-platform review credit (P0-4)", () => {
  it("credits Gerrit/bors review from commit trailers (was invisible to the GitHub PR API)", () => {
    const rust = repoSnap(
      [{ path: "Cargo.toml", content: "[package]" }],
      [{ message: "Auto merge of #99 - fix bug, r=alice\n\nreviewed by alice" }],
    );
    expect(labelText(dimOf(rust, "D6").signals)).toMatch(/Code review via off-platform gate \(bors/);
  });
});

describe("applyPrSignals — off-platform review no longer drags D6 (P0-4)", () => {
  const d6base = (): DimensionSignals[] => [{ id: "D6", signalScore: 60, signals: [] }];
  // A real, measured 0% GitHub review rate (bors merges without a native approving review).
  const prStats0 = { analyzed: 5, merged: 5, reviewedRate: 0, smallPrRate: 80, revertRate: 0, aiInvolvedRate: 0, aiGovernedRate: null, tools: [] } as unknown as PrStats;
  const scoreOf = (out: DimensionSignals[]) => out.find((s) => s.id === "D6")!.signalScore;

  it("a measured 0% review rate drags D6 by default, but not when review is off-platform", () => {
    const dragged = scoreOf(applyPrSignals(d6base(), prStats0));
    const offPlatform = scoreOf(applyPrSignals(d6base(), prStats0, { offPlatformReview: true }));
    expect(offPlatform).toBeGreaterThan(dragged);
    const label = applyPrSignals(d6base(), prStats0, { offPlatformReview: true }).find((s) => s.id === "D6")!.signals.map((x) => x.label).join(" ");
    expect(label).toMatch(/off-GitHub/);
  });
});

describe("detectAiUsage — real AI vs bot fraction (P0-5)", () => {
  it("does NOT flag AI when the only 'AI' is automation bots (Dependabot/Renovate)", () => {
    // The old bot-commit-fraction heuristic read these as 100% AI; the fix keys on genuine AI evidence.
    const botsOnly = repoSnap([{ path: "README.md", content: "# r" }], [
      { message: "Bump lodash from 1 to 2", authorLogin: "dependabot[bot]" },
      { message: "chore(deps): update react", authorLogin: "renovate[bot]" },
    ]);
    const u = detectAiUsage(botsOnly);
    expect(u.detected).toBe(false);
    expect(u.signals.join(" ")).toMatch(/bot-authored \(automation, not AI coding\)/);
  });

  it("flags AI from PR-level involvement with tool attribution, not commit fraction", () => {
    const bare = repoSnap([{ path: "README.md", content: "# r" }], [{ message: "fix: x", authorLogin: "human" }]);
    const prStats = { analyzed: 40, aiInvolvedRate: 48, tools: [{ name: "Claude", count: 19 }, { name: "Cursor", count: 4 }] } as unknown as PrStats;
    const u = detectAiUsage(bare, prStats);
    expect(u.detected).toBe(true);
    expect(u.signals.join(" ")).toMatch(/AI involved in 48% of recent PRs \(Claude 19, Cursor 4\)/);
  });

  it("still flags AI from a genuine co-author trailer (not a bot)", () => {
    const claude = repoSnap([{ path: "README.md", content: "# r" }], [
      { message: "feat: y\n\nCo-Authored-By: Claude <noreply@anthropic.com>", authorLogin: "alice" },
    ]);
    expect(detectAiUsage(claude).detected).toBe(true);
  });
});

describe("D3 delivery keyword false-positives (P1-3)", () => {
  const wf = { path: ".github/workflows/ci.yml", content: "jobs:\n  t:\n    steps:\n      - run: pnpm test" };
  it("does not credit DB migrations that live only in examples/", () => {
    const s = repoSnap([wf, { path: "examples/blog/prisma/migrations/0001_init/migration.sql", content: "CREATE TABLE post ()" }, { path: "package.json", content: "{}" }]);
    expect(labelText(dimOf(s, "D3").signals)).not.toMatch(/Versioned DB migrations/);
  });
  it("still credits real DB migration files in core", () => {
    const s = repoSnap([wf, { path: "prisma/migrations/0001_init/migration.sql", content: "CREATE TABLE post ()" }]);
    expect(labelText(dimOf(s, "D3").signals)).toMatch(/Versioned DB migrations/);
  });
  it("no longer credits progressive delivery from a bare 'feature-flag' keyword (SDK product code)", () => {
    const s = repoSnap([wf, { path: "src/feature-flags.ts", content: "export const flag = true" }]);
    expect(labelText(dimOf(s, "D3").signals)).not.toMatch(/Progressive delivery/);
  });
});

describe("D4 phantom AI-review-agent fix (P1-4)", () => {
  it("does NOT credit an AI review agent from a generic path token like 'sweep' (golang/go's mgcsweep.go)", () => {
    const s = repoSnap([
      { path: ".github/workflows/ci.yml", content: "jobs:\n  t:\n    steps:\n      - run: go test ./..." },
      { path: "src/runtime/mgcsweep.go", content: "package runtime" },
    ]);
    expect(labelText(dimOf(s, "D4").signals)).not.toMatch(/AI code-review agent/);
  });
  it("still credits a real AI review bot from its config file", () => {
    expect(labelText(dimOf(repoSnap([{ path: ".coderabbit.yaml", content: "reviews: {}" }]), "D4").signals)).toMatch(/AI code-review agent/);
  });
});

describe("D4 org-level dependency bot (P1-2)", () => {
  it("credits an active dependency bot from commit fingerprints even with no committed config", () => {
    const s = repoSnap([{ path: "go.mod", content: "module x" }], [
      { message: "Bump golang.org/x/net from 1 to 2", authorLogin: "dependabot[bot]" },
      { message: "chore(deps): update actions", authorLogin: "renovate[bot]" },
    ]);
    expect(labelText(dimOf(s, "D4").signals)).toMatch(/Dependency update bot active \(org\/App-level/);
  });
});

// The reference-scan audit's HEADLINE regression, at the rollup level: golang/go scored overall ~20
// ("Manual") with D3=1 while golang/appengine scored 74 for the SAME org, differing only by CI hosting
// (golang runs CI + review on Gerrit/LUCI, invisible to a .github/workflows-only detector). The per-
// detector fixes are pinned above; this pins the COMPOSITE — a deterministic, reproducible stand-in for
// a live re-scan (the score's trust rides on reproducibility) — proving CI hosting no longer decides the grade.
describe("golang-floor regression — CI hosting must not decide the overall grade (reference-scan audit)", () => {
  const NOW = "2026-06-10T00:00:00Z";
  // A golang/go-style repo: world-class engineering, but CI + review run OFF GitHub (Gerrit trailers),
  // and tests run via a Makefile the gate invokes. No .github/workflows anywhere.
  const GO_FILES = [
    { path: "go.mod", content: "module golang.org/x/example\n\ngo 1.22\n" },
    { path: "Makefile", content: "test:\n\tgo test ./...\nvet:\n\tgo vet ./...\n" },
    { path: "src/runtime/proc.go", content: "package runtime\nfunc schedule() {}\n" },
    { path: "src/runtime/proc_test.go", content: 'package runtime\nimport "testing"\nfunc TestSchedule(t *testing.T) {}\n' },
    { path: "README.md", content: "# The Go Programming Language\n\nGo is an open source programming language.\n" },
    { path: "doc/contribute.md", content: "# Contribution Guide\n\nGo uses Gerrit for code review.\n" },
  ];
  const GERRIT_COMMITS: CommitInfo[] = [
    { message: "runtime: fix scheduler race\n\nChange-Id: I0123456789abcdef0123456789abcdef01234567\nReviewed-on: https://go-review.googlesource.com/c/go/+/12345", authorLogin: "gopher1" },
    { message: "net/http: tighten server timeout\n\nChange-Id: Iabcdef0123456789abcdef0123456789abcdef01\nReviewed-on: https://go-review.googlesource.com/c/go/+/12346", authorLogin: "gopher2" },
    { message: "cmd/compile: inline small funcs\n\nChange-Id: I9876543210fedcba9876543210fedcba98765432\nReviewed-on: https://go-review.googlesource.com/c/go/+/12347", authorLogin: "gopher3" },
  ];
  const goRepo = repoSnap(GO_FILES, GERRIT_COMMITS);
  // The GitHub-native twin: identical engineering, but the SAME test step runs in a GitHub Actions
  // workflow — so the ONLY difference between the two is where CI is hosted.
  const ghaRepo = repoSnap(
    [...GO_FILES, { path: ".github/workflows/ci.yml", content: "jobs:\n  test:\n    steps:\n      - run: go test ./..." }],
    GERRIT_COMMITS,
  );
  const arch = classifyArchetype(goRepo);
  const overallOf = (s: RepoSnapshot) =>
    overallScoreFor(analyzeSignals(s, NOW).map((d) => ({ id: d.id, score: d.signalScore })), arch);

  it("credits D3 (CI/CD) for the off-GitHub repo — was a false ~1 that floored the org", () => {
    expect(dimOf(goRepo, "D3").signalScore).toBeGreaterThanOrEqual(35);
  });

  it("un-flooring the invisible off-GitHub CI lifts the overall rollup", () => {
    const dims = analyzeSignals(goRepo, NOW);
    const roll = (d3: number) =>
      overallScoreFor(dims.map((d) => ({ id: d.id, score: d.id === "D3" ? d3 : d.signalScore })), arch);
    const realD3 = dims.find((d) => d.id === "D3")!.signalScore;
    // Pre-fix, the .github/workflows-only detector scored this repo's CI a false 1; now it's credited.
    expect(roll(realD3)).toBeGreaterThan(roll(1));
  });

  it("CI hosting alone no longer creates a chasm — the off-GitHub repo and its GitHub-Actions twin score within a few points (was 20 vs 74)", () => {
    expect(Math.abs(overallOf(goRepo) - overallOf(ghaRepo))).toBeLessThanOrEqual(8);
  });
});

describe("D1 broadened AI-tooling detection (P1-4)", () => {
  it("credits an AI-usage policy/guide (AI_POLICY.md)", () => {
    const s = repoSnap([{ path: "docs/AI_POLICY.md", content: "AI contribution policy" }, { path: "README.md", content: "# r" }]);
    expect(labelText(dimOf(s, "D1").signals)).toMatch(/AI-usage policy\/guide/);
  });
});

describe("D2 test detection — testify + CI-run tests (P2-2)", () => {
  it("credits testify-style assertions (require.NoError / assert.Equal) as substantive", () => {
    const s = repoSnap([
      { path: "foo_test.go", content: "func TestX(t *testing.T){ require.NoError(t, err); assert.Equal(t, 1, got); assert.Nil(t, x); require.Len(t, xs, 3) }" },
      { path: "foo.go", content: "package foo" },
      { path: "go.mod", content: "module x\nrequire github.com/stretchr/testify v1" },
    ]);
    const labels = labelText(dimOf(s, "D2").signals);
    expect(labels).toMatch(/Sampled tests assert behavior/);
    expect(labels).not.toMatch(/assert nothing/);
  });
  it("credits tests that run in CI even when no test files match (Rust doctests)", () => {
    const s = repoSnap([
      { path: ".github/workflows/ci.yml", content: "jobs:\n  t:\n    steps:\n      - run: cargo test --all" },
      { path: "src/lib.rs", content: "//! doctest" },
      { path: "Cargo.toml", content: "[package]" },
    ]);
    expect(labelText(dimOf(s, "D2").signals)).toMatch(/Tests run in CI/);
  });
});

describe("D2 'assert nothing' penalty requires a representative sample (G3-11)", () => {
  const ASSERTION_FREE = 'it("a", () => {}); it("b", () => {}); it("c", () => {}); it("d", () => {});';

  it("still applies the -15 when the sampled slice covers most of the repo's test files", () => {
    // 3 total test files, all 3 sampled with content — sample fraction 1.0 (>= the 0.3 floor).
    const s = repoSnap([
      { path: "a.test.js", content: ASSERTION_FREE },
      { path: "b.test.js", content: ASSERTION_FREE },
      { path: "c.test.js", content: ASSERTION_FREE },
      { path: "src/index.js", content: "module.exports = {}" },
    ]);
    expect(labelText(dimOf(s, "D2").signals)).toMatch(/assert nothing/);
  });

  it("downgrades to a neutral note (no -15) when the sample is a small, unrepresentative slice of the full suite", () => {
    // 20 total test files (by path), but only 3 were content-sampled (ingest-budget slice) — sample
    // fraction 0.15, below the 0.3 floor. The full suite may be well-tested elsewhere; this sample
    // can't indict it.
    const unsampled = Array.from({ length: 17 }, (_, i) => ({ path: `test/unsampled-${i}.test.js` }));
    const s = repoSnap([
      { path: "a.test.js", content: ASSERTION_FREE },
      { path: "b.test.js", content: ASSERTION_FREE },
      { path: "c.test.js", content: ASSERTION_FREE },
      ...unsampled,
      { path: "src/index.js", content: "module.exports = {}" },
    ]);
    const labels = labelText(dimOf(s, "D2").signals);
    expect(labels).not.toMatch(/assert nothing/);
    expect(labels).toMatch(/too small relative to the full suite/);
  });
});

describe("D5 docs — HTML/Setext headers + apps/docs (P2-3)", () => {
  it("counts HTML <h2> headers, not just markdown ##", () => {
    const s = repoSnap([{ path: "README.md", content: "x".repeat(1600) + "\n<h2>Install</h2>\n<h2>Usage</h2>\n<h2>API</h2>" }]);
    const sig = dimOf(s, "D5").signals.find((x) => /Substantial README/.test(x.label));
    expect(sig?.detail).toMatch(/3 sections/);
  });
  it("credits an apps/docs documentation site", () => {
    const s = repoSnap([{ path: "apps/docs/index.mdx", content: "# docs" }, { path: "README.md", content: "# r" }]);
    expect(labelText(dimOf(s, "D5").signals)).toMatch(/Dedicated \/docs/);
  });
});

describe("D7 credits genuine AI authorship, not bots (P2-4)", () => {
  it("does not credit AI-assisted commits for a bot-only (Renovate/Dependabot) history", () => {
    const commits = Array.from({ length: 10 }, (_, i) => ({ message: `chore(deps): bump ${i}`, authorLogin: "renovate[bot]" }));
    const labels = labelText(dimOf(repoSnap([{ path: "README.md", content: "# r" }], commits), "D7").signals);
    expect(labels).not.toMatch(/AI-assisted commits/);
    expect(labels).toMatch(/Automation-bot commits present/);
  });
  it("credits AI-assisted commits from genuine co-author trailers", () => {
    const commits = Array.from({ length: 10 }, (_, i) => ({ message: `feat: ${i}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`, authorLogin: "alice" }));
    expect(labelText(dimOf(repoSnap([{ path: "README.md", content: "# r" }], commits), "D7").signals)).toMatch(/Frequent AI-assisted commits/);
  });
});

describe("classifyArchetype — run-style, not popularity (ambiguity-ui maturity-model #5)", () => {
  const commitsBy = (...logins: string[]) =>
    logins.map((login, i) => ({ message: `feat: c${i}`, authorLogin: login }));

  it("caps a viral SINGLE-maintainer repo at 'team' — 1000 stars must not force the org lens", () => {
    // Pre-fix: stars >= 1000 alone returned "org", doubling D3 (0.07→0.14) and more-than-doubling
    // D9 (0.04→0.09) against a repo the lens exists to judge fairly as single-author work.
    const viral = snap({ stars: 1500 }, commitsBy("alice", "alice", "alice"));
    expect(classifyArchetype(viral)).toBe("team");
  });

  it("caps a two-author repo at 'team' regardless of stars; bots don't count as authors", () => {
    const s = snap({ stars: 5000 }, [
      ...commitsBy("alice", "bob"),
      { message: "chore(deps): bump x", authorLogin: "renovate[bot]" },
      { message: "chore(deps): bump y", authorLogin: "dependabot[bot]" },
    ]);
    expect(classifyArchetype(s)).toBe("team");
  });

  it("still classifies a starred repo with broad contributor evidence as 'org'", () => {
    expect(classifyArchetype(snap({ stars: 1500 }, commitsBy("alice", "bob", "carol")))).toBe("org");
  });

  it("falls back to the star heuristic when the commit window is EMPTY (author count unknown)", () => {
    expect(classifyArchetype(snap({ stars: 1500 }, []))).toBe("org");
  });

  it("direct governance evidence (CODEOWNERS + ≥2 workflows) is 'org' even for one author", () => {
    const s = snap({ stars: 0 }, commitsBy("alice"));
    s.tree = [
      { path: "CODEOWNERS", type: "blob" },
      { path: ".github/workflows/ci.yml", type: "blob" },
      { path: ".github/workflows/release.yml", type: "blob" },
    ];
    expect(classifyArchetype(s)).toBe("org");
  });

  it("keeps the unchanged lower rungs: 50+ stars → team, quiet unstarred repo → solo", () => {
    expect(classifyArchetype(snap({ stars: 60 }, commitsBy("alice")))).toBe("team");
    expect(classifyArchetype(snap({ stars: 3 }, commitsBy("alice")))).toBe("solo");
  });
});
