// r22 (backlog develop-2026-09-17 row 42): the D9 battery credits a SAST or supply-chain App seen ONLY
// on recent merged PR heads, the same as one on the scored commit.
//
// Default-setup CodeQL and the Semgrep/Sonar/Socket Apps typically post on `pull_request` events, so a
// scored default-branch commit can carry no suite from them while every merged PR did. The award is
// the scored commit's award (SAST 10, dependency-updates 6): the PR is where those controls gate a
// change. Same guards as the r7 inventory: additive only, a null inventory is byte-identical, and a
// truncated PR-head read keeps what it named. The last block pins the D9 CARRY: a worktree rescan that
// replays an observed scan's security inputs must re-run the battery with the PR-head Apps too, or
// the rescan's D9 falls for a repo that did nothing.

import { describe, it, expect } from "vitest";
import { computeSecurityChecks } from "./checks";
import { buildScanScoreInput } from "@/lib/scan-score-input";
import { parsePlatformSignals } from "@/lib/analyze/platform-carry";
import type { AppInventory } from "@/lib/github/check-suites";
import type { RepoFile, RepoSnapshot } from "@/lib/types";

function snap(files: { path: string; content: string }[]): RepoSnapshot {
  const tree: RepoFile[] = files.map((f) => ({ path: f.path, type: "blob" as const }));
  return {
    meta: { owner: "acme", name: "r", url: "", stars: 0, forks: 0, defaultBranch: "main" },
    tree,
    files: files.map((f) => ({ path: f.path, content: f.content, bytes: f.content.length })),
    commits: [],
    truncated: false,
    coverage: 1,
  };
}
const get = (a: ReturnType<typeof computeSecurityChecks>, id: string) => a.checks.find((c) => c.id === id)!;
const suite = (slug: string) => ({ slug, name: slug, conclusion: "success" });
const inv = (commit: string[], prHead?: string[], prHeadTruncated = false): AppInventory => ({
  sha: "deadbeef",
  apps: commit.map(suite),
  total: commit.length,
  truncated: false,
  ...(prHead ? { prHeadApps: prHead.map(suite), prHeadShas: ["pr1"], prHeadTruncated } : {}),
});

const noSastWf = snap([{ path: ".github/workflows/ci.yml", content: "jobs:\n  test:\n    steps:\n      - run: go test ./..." }]);
const noConfig = snap([{ path: "go.mod", content: "module x" }]);

describe("SAST: a code-scanning App seen only on PR heads", () => {
  it("turns the searched-for 0 into a 10, and says it was seen on PR heads", () => {
    expect(get(computeSecurityChecks(noSastWf, null, null, null, inv(["github-actions"])), "sast").score).toBe(0);
    const c = get(computeSecurityChecks(noSastWf, null, null, null, inv(["github-actions"], ["github-code-scanning"])), "sast");
    expect(c.score).toBe(10);
    expect(c.evidence).toBe("Code scanning App active on recent PR heads (github-code-scanning).");
    expect(c.remediation).toBeUndefined();
  });

  it("fills the n/a when there are no workflows at all", () => {
    const c = get(computeSecurityChecks(snap([{ path: "README.md", content: "# r" }]), null, null, null, inv([], ["semgrep-app"])), "sast");
    expect(c.score).toBe(10);
  });

  it("names both places once when the commit and a PR head carry different scanners", () => {
    const c = get(computeSecurityChecks(noSastWf, null, null, null, inv(["github-code-scanning"], ["semgrep-app"])), "sast");
    expect(c.score).toBe(10);
    expect(c.evidence).toBe("Code scanning App active on the scored commit (github-code-scanning) and on recent PR heads (semgrep-app).");
  });

  it("a truncated PR-head read keeps the credit it names", () => {
    expect(get(computeSecurityChecks(noSastWf, null, null, null, inv([], ["github-code-scanning"], true)), "sast").score).toBe(10);
  });

  it("guard: a truncated PR-head read that named nothing leaves the battery byte-identical", () => {
    const bare = computeSecurityChecks(noSastWf, null, null, null, inv(["github-actions"]));
    expect(computeSecurityChecks(noSastWf, null, null, null, inv(["github-actions"], [], true))).toEqual(bare);
  });

  it("guard: CI and deploy Apps on PR heads change nothing in D9", () => {
    const bare = computeSecurityChecks(noSastWf, null, null, null, inv([]));
    expect(computeSecurityChecks(noSastWf, null, null, null, inv([], ["circleci", "vercel", "codecov"]))).toEqual(bare);
  });
});

describe("dependency-updates: a supply-chain App seen only on PR heads", () => {
  it("earns the same partial 6 as one on the scored commit, keeping the remediation", () => {
    const c = get(computeSecurityChecks(noConfig, null, null, null, inv([], ["socket-security"])), "dependency-updates");
    expect(c.score).toBe(6);
    expect(c.evidence).toBe("Supply-chain scanner App active on recent PR heads (socket-security); no dependency-update config committed.");
    expect(c.remediation).toBe("Add a `.github/dependabot.yml` (or Renovate) config.");
  });
});

describe("the D9 carry replays the PR-head Apps", () => {
  const NOW = "2026-09-24T00:00:00.000Z";
  it("a worktree rescan carrying an observed record scores the same SAST and D9 as the observed scan", async () => {
    const observed = await buildScanScoreInput({
      snapshot: noSastWf, prStats: null, governance: null, securityPosture: null, securityExposure: null,
      appInventory: inv(["github-actions"], ["github-code-scanning"]), ciHealth: null, now: NOW,
    });
    const sast = observed.scoreInput.securityAssessment!.checks.find((c) => c.id === "sast")!;
    expect(sast.score).toBe(10);
    // Through persistence: the record is stored as JSON and narrowed back on the next scan.
    const record = parsePlatformSignals(JSON.stringify(observed.platformSignals))!;
    expect(record.securityInputs?.apps?.prHeadApps?.map((a) => a.slug)).toEqual(["github-code-scanning"]);
    const rescan = await buildScanScoreInput({
      snapshot: noSastWf, prStats: null, governance: null, securityPosture: null, securityExposure: null,
      appInventory: null, ciHealth: null, now: NOW,
      platformSignalsUnobservable: true, carriedPlatformSignals: { record, scanId: "scan_obs" },
    });
    expect(rescan.scoreInput.securityAssessment!.checks.find((c) => c.id === "sast")!.score).toBe(10);
    const d9 = (r: typeof observed) => r.signals.find((s) => s.id === "D9")!.signalScore;
    expect(d9(rescan)).toBe(d9(observed));
  });
});
