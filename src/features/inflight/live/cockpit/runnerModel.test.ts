// The standing runner's on-screen words, pinned without a renderer. Two claims carry the weight:
//
//   - a runner is read as a RUNNER: its phase says running / paused-on-what-until-when / idle-until-
//     when, and none of a bounded drive's words ("run N/M", green, dry, ceiling) ever appears;
//   - `paused` and `idle` are LIVE — waits, not ends — so the poll and the Stop button stay.
//
// Clock times are built from LOCAL dates, so "00:00" and "15:00" hold in any timezone the suite runs in.

import { describe, expect, it } from "vitest";
import { driveProgress, driveVerdict } from "./driveModel";
import { driveHeaderCaption, nextWake, runnerFigures, runnerPhase, runnerRepoRows, runnerStopHint } from "./runnerModel";
import { at, repoState as repo, runnerDrive } from "./runner.fixture";

describe("runnerPhase", () => {
  it("names the breaker and when it lifts", () => {
    expect(runnerPhase(runnerDrive()).label).toBe("Running");
    const spend = runnerDrive({ phase: "paused", pausedReason: "spend-ceiling", pausedUntil: new Date(2026, 8, 19, 0, 0).toISOString() });
    expect(runnerPhase(spend)).toEqual({ label: "Paused — spend ceiling until 00:00", tone: "warn", live: true });
    const limit = runnerDrive({ phase: "paused", pausedReason: "session-limit", pausedUntil: at(15) });
    expect(runnerPhase(limit).label).toBe("Paused — session limit until 15:00");
  });

  it("says when an idle runner next has work — the earliest timed repo pause", () => {
    const states = [
      repo({ repo: "acme/web", paused: "dry-backoff", pausedUntil: at(16) }),
      repo({ repo: "acme/api", paused: "dry-backoff", pausedUntil: at(14, 20) }),
    ];
    expect(nextWake(states)).toBe(at(14, 20));
    expect(runnerPhase(runnerDrive({ phase: "idle", repoState: states })).label).toBe("Idle — next repo wakes 14:20");
    // Every repo held for the operator: nothing wakes by itself.
    const held = [repo({ repo: "acme/web", paused: "branch-conflict" })];
    expect(runnerPhase(runnerDrive({ phase: "idle", repoState: held })).label).toBe("Idle — every repo waits for you");
  });
});

describe("a runner is live while it waits", () => {
  it("counts paused and idle as live, and stopped as not", () => {
    expect(driveProgress(runnerDrive({ phase: "paused" })).live).toBe(true);
    expect(driveProgress(runnerDrive({ phase: "idle" })).live).toBe(true);
    expect(driveProgress(runnerDrive({ phase: "stopped", endedAt: at(13) })).live).toBe(false);
    expect(driveProgress(runnerDrive()).continuous).toBe(true);
  });
});

describe("driveVerdict for a runner", () => {
  it("never borrows a bounded drive's words", () => {
    for (const phase of ["running", "paused", "idle", "stopped", "interrupted"] as const) {
      const v = driveVerdict(runnerDrive({ phase, runs: [{ runId: "r1", repos: ["acme/web"], debtBefore: 0, debtAfter: 0, startedAt: at(9), endedAt: at(10) }] }));
      expect(`${v.label} ${v.detail}`).not.toMatch(/green|dry|ceiling ran out|run budget|of 3/i);
    }
  });

  it("says a stopped runner's work stays on its branch", () => {
    const v = driveVerdict(runnerDrive({ phase: "stopped", endedAt: at(13) }));
    expect(v.label).toBe("Stopped");
    expect(v.detail).toContain("ascent/runner");
  });

  it("quotes the breaker's own sentence while paused", () => {
    const d = runnerDrive({
      phase: "paused",
      pausedReason: "spend-ceiling",
      pausedUntil: at(23, 59),
      events: [{ event: "paused", at: at(12), repo: null, reason: "spend-ceiling", until: at(23, 59), note: "Today's lane spend ($101.20) reached the ceiling." }],
    });
    expect(driveVerdict(d).detail).toBe("Today's lane spend ($101.20) reached the ceiling.");
  });
});

describe("runnerFigures", () => {
  it("counts runs with no cap, sums what landed, and shows the ceiling — or says there is none", () => {
    const runs = [
      { runId: "r1", repos: ["acme/web"], debtBefore: 0, debtAfter: 0, startedAt: at(9), endedAt: at(10), landed: 2, verifiedCloses: 1 },
      { runId: "r2", repos: ["acme/web"], debtBefore: 0, debtAfter: null, startedAt: at(10), endedAt: null, landed: null },
    ];
    const f = runnerFigures(runnerDrive({ runs, runsBefore: 4 }));
    expect(f.runsDone).toBe(5);
    expect(f.landed).toBe(2);
    expect(f.verifiedCloses).toBe(1);
    expect(f.ceiling).toBe("$100.00 / day");
    expect(f.uptime).toBe("3 h 12 m");
    expect(runnerFigures(runnerDrive({ spendCeilingMicros: null })).ceiling).toBeNull();
    // Nothing counted yet is unknown, not zero.
    expect(runnerFigures(runnerDrive()).landed).toBeNull();
  });
});

describe("runnerRepoRows", () => {
  it("carries each repo's base, pause, note and streaks; any paused repo is resumable", () => {
    const d = runnerDrive({
      repoState: [
        repo({ repo: "acme/web", paused: "repo-failures", note: "The guard rejected three lanes.", failureStreak: 3, aheadOfBase: 4 }),
        repo({ repo: "acme/api", failureStreak: 2, dryStreak: 1 }),
      ],
    });
    const [web, api] = runnerRepoRows(d);
    expect(web).toMatchObject({ short: "web", base: "main", ahead: 4, pause: "3 failed lanes", until: null, resumable: true });
    expect(web!.note).toBe("The guard rejected three lanes.");
    expect(api).toMatchObject({ pause: null, resumable: false, streaks: "2 failed in a row · 1 dry run" });
  });
});

describe("the masthead and Stop", () => {
  it("captions a runner as a runner, and a bounded drive as it always was", () => {
    expect(driveHeaderCaption(runnerDrive({ phase: "paused", pausedReason: "session-limit", pausedUntil: at(15) }), true)).toBe(
      "runner · paused — session limit until 15:00 · 0 runs",
    );
    expect(driveHeaderCaption(runnerDrive({ mode: "bounded", runs: [] }), true)).toBe("drive · run 0/3");
    expect(driveHeaderCaption(runnerDrive(), false)).toBeNull();
  });

  it("tells a waiting runner's Stop apart from a working one's", () => {
    expect(runnerStopHint(runnerDrive({ phase: "idle" }))).toMatch(/next beat/);
    expect(runnerStopHint(runnerDrive())).toMatch(/in-flight lanes/);
    expect(runnerStopHint(runnerDrive())).toContain("ascent/runner");
  });
});
