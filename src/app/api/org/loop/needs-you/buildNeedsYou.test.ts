// The needs-you assembly: pending plans only, the pulse's own `needsOperator` rule for paused repos (a
// dry backoff is the runner resting, not asking), the runner-wide pause, and the `runner` flag.

import { describe, expect, it } from "vitest";
import type { DriveStatus } from "@/lib/local/drive-types";
import type { LoopPlanRecord, RepoRunnerState } from "@/lib/local/runner-types";
import { buildNeedsYou } from "./buildNeedsYou";

const plan = (o: Partial<LoopPlanRecord> = {}): LoopPlanRecord => ({
  id: "plan-1", orgId: "o", repo: "acme/web", runId: null, laneId: null, directionId: null, itemKeys: [], recIds: [], itemTitles: [],
  plan: { v: 1, intent: "Split the api module", items: [], modules: [], check: "", risks: [], notDoing: [] },
  planText: "", partition: null, cls: "major", clsReason: "declared-moves", status: "pending", sessionId: null, heldBranch: null,
  decidedBy: null, decidedAt: null, decisionNote: null, createdAt: "2026-09-18T10:00:00Z", updatedAt: "2026-09-18T10:00:00Z", ...o,
});
const repoState = (repo: string, paused: RepoRunnerState["paused"], note: string | null = null): RepoRunnerState => ({
  repo, baseBranch: "main", paused, pausedUntil: null, note, failureStreak: 0, dryStreak: 0, lastMergeInSha: null, lastLandedSha: null, aheadOfBase: null,
});
const drive = (o: Partial<DriveStatus> = {}): DriveStatus => ({
  id: "d1", org: "acme", phase: "running", repos: [], maxRuns: 8, maxCycles: 3, concurrency: 2, runs: [], measurement: null, runsBefore: 0,
  resumedFrom: null, startedAt: "2026-09-18T08:00:00Z", endedAt: null, error: null, stopRequested: false, mode: "continuous", repoState: [], ...o,
});

describe("buildNeedsYou", () => {
  it("pending plans with a one-line title; only operator pauses; the runner-wide pause; the runner flag", () => {
    const res = buildNeedsYou(
      [plan(), plan({ id: "plan-2", status: "approved" })],
      [drive({ phase: "paused", pausedReason: "spend-ceiling", pausedUntil: "2026-09-19T00:00:00Z", repoState: [repoState("acme/kp", "branch-conflict", "src/a.ts"), repoState("acme/sys", "dry-backoff"), repoState("acme/x", null)] })],
    );
    expect(res).toEqual({
      runner: true,
      plans: [{ id: "plan-1", repo: "acme/web", title: "Split the api module", createdAt: "2026-09-18T10:00:00Z" }],
      pausedRepos: [{ repo: "acme/kp", reason: "branch-conflict", note: "src/a.ts" }],
      runnerPaused: { reason: "spend-ceiling", until: "2026-09-19T00:00:00Z" },
    });
  });

  it("a bounded drive or a finished runner is not a runner", () => {
    expect(buildNeedsYou([], [drive({ mode: undefined }), drive({ phase: "stopped" })]).runner).toBe(false);
    expect(buildNeedsYou([], []).runnerPaused).toBeNull();
  });

  it("the pulse's rule decides which pauses count: every paused reason but a dry backoff", () => {
    const res = buildNeedsYou([], [drive({ repoState: [repoState("a/1", "repo-failures"), repoState("a/2", "dependency-install"), repoState("a/3", "dry-backoff")] })]);
    expect(res.pausedRepos.map((r) => r.reason)).toEqual(["repo-failures", "dependency-install"]);
  });
});

