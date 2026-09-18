// THE `stageAt` CHOKEPOINT. Every lane write that moves `phase` or `stage` — an explicit `stage: null`
// included, because leaving a stage is entering the next one — stamps when it happened, so every lane
// stage has a start time without a single call site in the lane having to remember it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const writes: Record<string, unknown>[] = [];

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  getPrisma: () => ({
    loopRunLane: {
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        writes.push(data);
        // Enough of a row for `toLaneRecord`; the chokepoint is about `data`, not the round trip.
        return { id: "lane-1", runId: "run-1", repoFullName: "acme/api", cycle: 1, phase: "dispatching", branch: null, batchIdsJson: "[]", closedIdsJson: "[]", commits: 0, beforeScanId: null, afterScanId: null, stage: null, log: "", error: null, startedAt: null, endedAt: null };
      }),
    },
  }),
}));
vi.mock("@/lib/db/org-shared", () => ({ getOrgBySlug: vi.fn(async () => null) }));

import { updateLane } from "@/lib/db/loop-runs-write";

beforeEach(() => {
  writes.length = 0;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-18T10:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("updateLane stamps stageAt", () => {
  it("when the patch moves the stage", async () => {
    await updateLane("lane-1", { stage: "verifying" });
    expect(writes[0]).toMatchObject({ stage: "verifying", stageAt: new Date("2026-09-18T10:00:00.000Z") });
  });

  it("when the patch clears the stage — an explicit null is a transition", async () => {
    await updateLane("lane-1", { stage: null });
    expect(writes[0]!.stageAt).toEqual(new Date("2026-09-18T10:00:00.000Z"));
  });

  it("when the patch moves the phase", async () => {
    await updateLane("lane-1", { phase: "rescanning", commits: 2 });
    expect(writes[0]).toMatchObject({ phase: "rescanning", stageAt: expect.any(Date) });
  });

  it("never overrides a stageAt the caller named", async () => {
    const named = new Date("2026-09-18T09:00:00.000Z");
    await updateLane("lane-1", { stage: "planning", stageAt: named });
    expect(writes[0]!.stageAt).toBe(named);
    await updateLane("lane-1", { phase: "done", stageAt: null });
    expect(writes[1]!.stageAt).toBeNull();
  });

  it("leaves every other write alone — a heartbeat or a tail is not a stage change", async () => {
    await updateLane("lane-1", { heartbeatAt: new Date(), activity: [] });
    await updateLane("lane-1", { costMicros: 5, turns: 3 });
    await updateLane("lane-1", { diffStat: { files: 1, plus: 2, minus: 0 } });
    for (const w of writes) expect(w).not.toHaveProperty("stageAt");
    expect(writes[0]).toMatchObject({ activityJson: "[]" });
    expect(writes[2]).toMatchObject({ diffStatJson: JSON.stringify({ files: 1, plus: 2, minus: 0 }) });
  });
});
