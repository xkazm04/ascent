// Regression tests for two scan-and-decide fixes in the signal layer:
//   #5 (60dd3afd) — D7's recency bonus must guard a malformed pushedAt (and surface a note)
//                   instead of silently dropping the bonus via a NaN comparison.
//   #9 (4fd114f9) — AI/bot commit attribution is single-sourced; lock in the counts that
//                   detectAiUsage and computeContributors derive from the shared predicate.

import { describe, it, expect } from "vitest";
import { analyzeSignals, detectAiUsage, computeContributors } from "./index";
import type { CommitInfo, RepoMeta, RepoSnapshot, Signal } from "@/lib/types";

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
