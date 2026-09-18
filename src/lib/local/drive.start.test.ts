// `startDrive`, the one door for both drive shapes (spark theater-upgrade, 2026-09-18):
//   • a BOUNDED drive now hands every run it dispatches the operator's dials — five of them used to be
//     silently dropped, so every drive run ran on the deployment defaults;
//   • `mode: "continuous"` arms the standing runner: no rope, `runner` delivery, the daily ceiling, a
//     fresh per-repo state — and a ceiling the row cannot store is refused before anything is armed.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveStatus } from "./drive-types";

const measured = { calls: 0 };
vi.mock("@/lib/env", () => ({ selfHosted: () => true }));
vi.mock("@/lib/local/agent", () => ({
  autopilotEnabled: () => true,
  resolveAgentConfig: ({ model, effort }: { model?: string | null; effort?: string | null }) => ({ model: model ?? "sonnet", effort: effort ?? null }),
}));
vi.mock("@/lib/local/loop-engine", () => ({ startLoopRun: vi.fn(async () => ({ id: "run-1" })), stopLoopRun: vi.fn() }));
vi.mock("@/lib/db/loop-runs-read", () => ({
  getLoopRun: vi.fn(async () => ({ id: "run-1", endedAt: "2026-09-18T10:00:00.000Z" })),
  getOrgPriceList: vi.fn(async () => ({ rows: [] })),
}));
vi.mock("@/lib/db/drives", () => ({
  SPEND_CEILING_STORABLE_MAX_MICROS: 2_147_483_647,
  createDriveRow: vi.fn(async () => true),
  saveDriveRow: vi.fn(async () => undefined),
  getDriveRow: vi.fn(async () => null),
  listDriveRows: vi.fn(async () => []),
  markStaleDrivesInterrupted: vi.fn(async () => 0),
}));
vi.mock("@/lib/db", () => ({ getOrgRollup: vi.fn(async () => ({ repos: [] })), listLocalPairings: vi.fn(async () => []) }));
vi.mock("@/lib/local/drive-measure", () => ({
  // Debt on the first reading, green after the one run — so a bounded drive runs exactly once.
  measureDrive: vi.fn(async () =>
    measured.calls++ === 0
      ? { debt: 10, green: false, greenCount: 0, inScope: 1, remaining: ["acme/a"], unscanned: [] }
      : { debt: 0, green: true, greenCount: 1, inScope: 1, remaining: [], unscanned: [] },
  ),
}));
vi.mock("@/lib/local/runner-control", () => ({ launchRunner: vi.fn() }));

import { startDrive } from "./drive";
import { drives } from "./drive-registry";
import { startLoopRun } from "./loop-engine";
import { launchRunner } from "./runner-control";
import { DEFAULT_SPEND_CEILING_MICROS } from "./runner-types";

beforeEach(() => {
  vi.clearAllMocks();
  drives.clear();
  measured.calls = 0;
});

describe("a bounded drive carries the dials to every run", () => {
  it("spreads the set dials into startLoopRun", async () => {
    const st = await startDrive({ org: "acme", repos: ["acme/a"], dials: { batchSize: 8, agentTimeoutMs: 1_800_000, verifyMode: "off", rescanCadence: "run" } });
    await vi.waitFor(() => expect(st.phase).toBe("green"));
    expect(vi.mocked(startLoopRun).mock.calls[0]![0]).toMatchObject({
      org: "acme",
      repos: ["acme/a"],
      batchSize: 8,
      agentTimeoutMs: 1_800_000,
      verifyMode: "off",
      rescanCadence: "run",
    });
    expect(st.dials).toEqual({ batchSize: 8, agentTimeoutMs: 1_800_000, verifyMode: "off", rescanCadence: "run" });
  });

  it("without dials arms the run with exactly the input it always did", async () => {
    const st = await startDrive({ org: "acme", repos: ["acme/a"] });
    await vi.waitFor(() => expect(st.phase).toBe("green"));
    const input = vi.mocked(startLoopRun).mock.calls[0]![0];
    expect(Object.keys(input).sort()).toEqual(["actor", "concurrency", "delivery", "effort", "maxCycles", "model", "org", "repos"]);
    expect(st).not.toHaveProperty("dials");
    expect(launchRunner).not.toHaveBeenCalled();
  });
});

describe("mode: continuous arms the standing runner", () => {
  it("launches the runner with no rope, runner delivery, the default ceiling and a fresh repo state", async () => {
    const st = await startDrive({ org: "acme", repos: ["acme/a", "acme/b"], mode: "continuous", maxRuns: 5, delivery: "land", dials: { batchSize: 4 } });
    expect(launchRunner).toHaveBeenCalledTimes(1);
    const armed = vi.mocked(launchRunner).mock.calls[0]![0] as DriveStatus;
    expect(armed).toBe(st);
    expect(st).toMatchObject({
      mode: "continuous",
      phase: "running",
      maxRuns: 0,
      delivery: "runner",
      spendCeilingMicros: DEFAULT_SPEND_CEILING_MICROS,
      dials: { batchSize: 4 },
      pausedReason: null,
    });
    expect(st.repoState?.map((s) => [s.repo, s.paused, s.dryStreak])).toEqual([
      ["acme/a", null, 0],
      ["acme/b", null, 0],
    ]);
    expect(startLoopRun).not.toHaveBeenCalled();
  });

  it("an explicit 0 is no ceiling; a ceiling the row cannot store is refused before anything is armed", async () => {
    const st = await startDrive({ org: "acme", repos: ["acme/a"], mode: "continuous", spendCeilingUsd: 0 });
    expect(st.spendCeilingMicros).toBeNull();
    drives.clear();
    await expect(startDrive({ org: "acme", repos: ["acme/a"], mode: "continuous", spendCeilingUsd: 100 })).rejects.toThrow(/larger than/);
    expect(launchRunner).toHaveBeenCalledTimes(1);
  });

  it("is single-flight per org like every drive", async () => {
    await startDrive({ org: "acme", repos: ["acme/a"], mode: "continuous" });
    await expect(startDrive({ org: "acme", repos: ["acme/a"], mode: "continuous" })).rejects.toThrow(/already running/);
  });
});
