// THE RUNNER'S CONTROL SURFACE — the re-attach the boot sweep calls, and the operator's resume-repo.
// Every real seam is mocked or injected; the driver runs against a fake world that stops at once.

import { beforeEach, describe, expect, it, vi } from "vitest";

const saved: string[] = [];
vi.mock("@/lib/local/loop-engine", () => ({ startLoopRun: vi.fn(), stopLoopRun: vi.fn() }));
vi.mock("@/lib/db/loop-runs", () => ({ getLoopRun: vi.fn(), listLanes: vi.fn(async () => []) }));
vi.mock("@/lib/db/org-local", () => ({ getRepoLocalPath: vi.fn(async () => "/paired") }));
vi.mock("@/lib/db/runner-spend", () => ({ orgLaneSpendSince: vi.fn(async () => 0) }));
vi.mock("@/lib/local/drive-measure", () => ({ measureDrive: vi.fn(async () => null) }));
vi.mock("@/lib/db/drives", () => ({
  saveDriveRow: vi.fn(async (st: { phase: string }) => void saved.push(st.phase)),
  listDriveRows: vi.fn(async () => [
    { id: "old-bounded", mode: undefined, repoState: undefined },
    { id: "old-runner", mode: "continuous", repoState: [{ repo: "acme/api", baseBranch: "trunk" }] },
  ]),
}));

import { resumeRunnerDrives, resumeRunnerRepo, runnerBaseFor } from "./runner-control";
import { drives } from "./drive-registry";
import { freshRepoState } from "./runner-policy";
import { harness, runnerStatus } from "./runner.fixture";

beforeEach(() => {
  drives.clear();
  saved.length = 0;
});

describe("resumeRunnerDrives — the same row, re-attached", () => {
  it("closes the run the restart killed, records the restart, and pulls the SAME drive id", async () => {
    const st = runnerStatus({
      id: "drive-r",
      runs: [{ runId: "run-9", repos: ["o/a"], debtBefore: 0, debtAfter: null, startedAt: "t", endedAt: null }],
      // Stopped before the crash: honoured on the first iteration, so the test ends at once.
      stopRequested: true,
    });
    const h = harness({ lanes: () => [] });

    expect(resumeRunnerDrives([{ drive: st, createdBy: "octocat" }], h.deps)).toEqual(["drive-r"]);
    expect(drives.get("drive-r")).toBe(st);
    await vi.waitFor(() => expect(st.phase).toBe("stopped"));

    expect(st.runs[0]).toMatchObject({ endedAt: expect.any(String), note: expect.stringContaining("restart") });
    expect(st.events?.[0]).toMatchObject({ event: "restart-resumed", note: expect.stringContaining("Resumed after restart") });
  });

  it("does not launch a second driver for a drive this process already pulls, nor a bounded one", () => {
    const live = runnerStatus({ id: "drive-live" });
    drives.set(live.id, live);
    const h = harness({ lanes: () => [] });
    const bounded = { ...runnerStatus({ id: "drive-b" }), mode: "bounded" as const };
    expect(resumeRunnerDrives([{ drive: runnerStatus({ id: "drive-live" }), createdBy: null }, { drive: bounded, createdBy: null }], h.deps)).toEqual([
      "drive-live",
    ]);
    expect(drives.get("drive-live")).toBe(live);
    expect(drives.has("drive-b")).toBe(false);
  });
});

describe("resumeRunnerRepo — the operator lifts one repo's pause", () => {
  it("clears the pause and the failure streak, and records who", async () => {
    const st = runnerStatus({
      repoState: [{ ...freshRepoState("acme/api"), paused: "repo-failures", note: "3 runs failed", failureStreak: 3, dryStreak: 2 }],
    });
    drives.set(st.id, st);
    const res = await resumeRunnerRepo("acme", "acme/api");
    expect(res.ok).toBe(true);
    expect(st.repoState?.[0]).toMatchObject({ paused: null, note: null, failureStreak: 0, dryStreak: 2 });
    expect(st.events?.at(-1)).toMatchObject({ event: "repo-resumed", repo: "acme/api", reason: "repo-failures" });
    expect(saved).toHaveLength(1);
  });

  it("404s without a live runner or for a repo outside its scope; 409s a repo that is not paused", async () => {
    expect(await resumeRunnerRepo("acme", "acme/api")).toMatchObject({ ok: false, status: 404 });
    const st = runnerStatus({ repoState: [freshRepoState("acme/api")] });
    drives.set(st.id, st);
    expect(await resumeRunnerRepo("acme", "acme/other")).toMatchObject({ ok: false, status: 404 });
    expect(await resumeRunnerRepo("acme", "acme/api")).toMatchObject({ ok: false, status: 409 });
  });
});

describe("runnerBaseFor", () => {
  it("prefers the live runner's record, else the newest continuous row's, else null", async () => {
    expect(await runnerBaseFor("acme", "acme/api")).toBe("trunk");
    expect(await runnerBaseFor("acme", "acme/none")).toBeNull();
    const st = runnerStatus({ repoState: [{ ...freshRepoState("acme/api"), baseBranch: "main" }] });
    drives.set(st.id, st);
    expect(await runnerBaseFor("acme", "acme/api")).toBe("main");
  });
});
