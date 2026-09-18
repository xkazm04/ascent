// THE LEDGER'S LOAD: one pass, each read NAMED when it fails (so the view can say "could not" instead of
// drawing an empty list), the standing runner found by rule, the anchor snapshotted, and every
// commits-ahead count git could not produce — an error, a missing checkout, a hang — left UNKNOWN.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runnerDrive, repoState } from "./ledgerFixture";

const h = vi.hoisted(() => ({
  drives: [] as unknown[],
  drivesFail: false,
  plansFail: false,
  login: "alice" as string | null,
  seen: { seenAt: "2026-09-18T06:00:00.000Z" } as { seenAt: string | null } | null,
  selfHosted: true,
  ahead: new Map<string, () => Promise<number | null>>(),
}));

vi.mock("@/lib/local/drive", () => ({ listDrives: vi.fn(async () => (h.drivesFail ? Promise.reject(new Error("db")) : h.drives)) }));
vi.mock("@/lib/local/runner-branch", () => ({ runnerAheadCount: vi.fn((path: string) => (h.ahead.get(path) ?? (async () => 1))()) }));
vi.mock("@/lib/db/loop-runs", () => ({ getActiveLoopRun: async () => null, listLoopRuns: vi.fn(async () => []) }));
vi.mock("@/lib/db/loop-plans", () => ({ listLoopPlans: vi.fn(async () => (h.plansFail ? Promise.reject(new Error("db")) : [])) }));
vi.mock("@/lib/db/loop-directions", () => ({ listLoopDirections: async () => [] }));
vi.mock("@/lib/db/loop-lessons", () => ({ listRunnerKeptLessons: async () => [] }));
vi.mock("@/lib/db", () => ({
  listLocalPairings: async () => [
    { fullName: "acme/kp", localPath: "/c/kp" },
    { fullName: "acme/web", localPath: "/c/web" },
    { fullName: "acme/hang", localPath: "/c/hang" },
  ],
}));
vi.mock("@/lib/db/live-seen", () => ({ getLiveSeenAt: vi.fn(async () => h.seen) }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: async () => h.login }));
vi.mock("@/lib/authz", () => ({ hasOrgRole: async () => true }));
vi.mock("@/lib/env", () => ({ selfHosted: () => h.selfHosted }));

import { AHEAD_TIMEOUT_MS, hasStandingRunner, loadLedger, readAheadCounts, standingRunner } from "./ledgerLoad";
import { listLoopRuns } from "@/lib/db/loop-runs";

beforeEach(() => {
  h.drives = [];
  h.drivesFail = false;
  h.plansFail = false;
  h.login = "alice";
  h.seen = { seenAt: "2026-09-18T06:00:00.000Z" };
  h.selfHosted = true;
  h.ahead = new Map();
});
afterEach(() => vi.useRealTimers());

describe("the standing runner", () => {
  it("is a continuous drive that is live and has not ended", () => {
    const bounded = runnerDrive({ id: "b", mode: "bounded" });
    const ended = runnerDrive({ id: "e", phase: "stopped", endedAt: "2026-09-18T00:00:00Z" });
    const live = runnerDrive({ id: "r", phase: "idle" });
    expect(standingRunner([bounded, ended, live])?.id).toBe("r");
    expect(standingRunner([bounded, ended])).toBeNull();
  });

  it("is absent when the drive read fails — the tab then opens on the Cockpit", async () => {
    h.drivesFail = true;
    expect(await hasStandingRunner("acme")).toBe(false);
  });
});

describe("loadLedger", () => {
  it("snapshots the viewer's anchor and reads the chronicle's first page", async () => {
    h.drives = [runnerDrive()];
    const data = await loadLedger("acme");
    expect(data.seenAt).toBe("2026-09-18T06:00:00.000Z");
    expect(data.runner?.id).toBe("drive_runner");
    expect(data.driveModes).toEqual({ drive_runner: "continuous" });
    expect(data.failed).toEqual([]);
    expect(listLoopRuns).toHaveBeenCalledWith("acme", 20);
  });

  it("has no anchor for a viewer with no identity or no membership", async () => {
    h.login = null;
    expect((await loadLedger("acme")).seenAt).toBeNull();
    h.login = "alice";
    h.seen = null;
    expect((await loadLedger("acme")).seenAt).toBeNull();
  });

  it("NAMES a failed read and leaves its data null, never an empty list", async () => {
    h.plansFail = true;
    h.drivesFail = true;
    const data = await loadLedger("acme");
    expect(data.failed.sort()).toEqual(["drives", "plans"]);
    expect(data.pending).toBeNull();
    expect(data.plans).toBeNull();
    expect(data.runner).toBeNull();
  });

  it("keeps the newest stopped runner for the runner card when none is live", async () => {
    h.drives = [runnerDrive({ id: "old", phase: "stopped", endedAt: "2026-09-17T00:00:00Z" })];
    const data = await loadLedger("acme");
    expect(data.runner).toBeNull();
    expect(data.lastRunner?.id).toBe("old");
  });
});

describe("readAheadCounts", () => {
  const drive = runnerDrive({
    repoState: [repoState("acme/kp"), repoState("acme/web"), repoState("acme/nopath"), repoState("acme/nobase", { baseBranch: null })],
  });

  it("reads git per repo and leaves every failure unknown — never zero", async () => {
    h.ahead.set("/c/kp", async () => 3);
    h.ahead.set("/c/web", async () => Promise.reject(new Error("git exploded")));
    expect(await readAheadCounts("acme", drive)).toEqual({ "acme/kp": 3, "acme/web": null, "acme/nopath": null, "acme/nobase": null });
  });

  it("bounds a hung git call and reads it as unknown", async () => {
    vi.useFakeTimers();
    h.ahead.set("/c/hang", () => new Promise<number>(() => {}));
    const out = readAheadCounts("acme", runnerDrive({ repoState: [repoState("acme/hang")] }));
    await vi.advanceTimersByTimeAsync(AHEAD_TIMEOUT_MS + 1);
    expect(await out).toEqual({ "acme/hang": null });
  });

  it("asks nothing off a self-hosted deployment, or with no runner", async () => {
    h.selfHosted = false;
    expect(await readAheadCounts("acme", drive)).toEqual({});
    h.selfHosted = true;
    expect(await readAheadCounts("acme", null)).toEqual({});
  });
});
