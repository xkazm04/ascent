// DELIVERY DISPATCH — what `deliverLane` does per mode, with every seam injected.
//
// The claim worth the most here is the NEGATIVE one: under `branch` this function must read nothing
// and write nothing, because `branch` is required to be byte-identical to the loop as it behaved
// before delivery existed, and the only way to guarantee that is for the path to be empty. Every
// injected dep is therefore asserted un-called.
//
// The second claim is HONESTY: `pr` on a deployment with no GitHub App must refuse and say so, never
// quietly leave a branch behind while the operator believes their work is in review.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { deliverLane, type DeliverDeps } from "./loop-delivery";
import type { LandOutcome } from "./loop-land";
import type { LoopLaneRecord } from "@/lib/db/loop-runs-types";

const lane = (over: Partial<LoopLaneRecord> = {}): LoopLaneRecord =>
  ({
    id: "lane-1",
    runId: "run-1",
    repoFullName: "acme/web",
    cycle: 1,
    phase: "done",
    branch: "ascent/loop-20260830-acme-web",
    batchIds: [],
    closedIds: [],
    commits: 2,
    beforeScanId: "scan-a",
    afterScanId: "scan-b",
    stage: null,
    log: [],
    error: null,
    startedAt: null,
    endedAt: null,
    deliverables: [],
    model: "sonnet",
    costSource: null,
    costMicros: null,
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    turns: null,
    agentDurationMs: null,
    agentSessionId: null,
    abPairKey: null,
    dimId: "D9",
    prNumber: null,
    prUrl: null,
    brief: null,
    report: null,
    executor: "local",
    claimedBy: null,
    leaseUntil: null,
    // VERIFIED BY DEFAULT in this fixture. The run-level dial defaults to `on` (`verifyModeOf`), and
    // under `on` only a `verified` lane is delivered — so every test below that is about the land/PR
    // MECHANICS starts from the one verdict that lets the mechanics run. The verdict matrix itself is
    // exercised deliberately in "verification the operator asked for".
    verifyVerdict: "verified",
    verifyCommand: null,
    verifyNote: null,
    ...over,
  }) as LoopLaneRecord;

const landed: LandOutcome = { landed: true, refusal: null, into: "main", from: "aaa", to: "bbb", reason: "Landed it." };

let deps: DeliverDeps;
let mocks: {
  land: ReturnType<typeof vi.fn>;
  openPr: ReturnType<typeof vi.fn>;
  appConfigured: ReturnType<typeof vi.fn>;
  getLane: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
  noteRefusal: ReturnType<typeof vi.fn>;
  noteUnverified: ReturnType<typeof vi.fn>;
};

const input = {
  orgSlug: "acme",
  orgId: "org-1",
  laneId: "lane-1",
  pairedPath: "C:/work/web",
  actor: "octocat",
};

beforeEach(() => {
  mocks = {
    land: vi.fn(async () => landed),
    openPr: vi.fn(async () => ({ prNumber: 7, prUrl: "https://github.com/acme/web/pull/7", reused: false })),
    appConfigured: vi.fn(() => true),
    getLane: vi.fn(async () => lane()),
    log: vi.fn(async () => null),
    noteRefusal: vi.fn(async () => null),
    noteUnverified: vi.fn(async () => null),
  };
  deps = mocks as unknown as DeliverDeps;
});

describe("branch (the default)", () => {
  it("does nothing at all — no read, no git, no log, no lesson", async () => {
    const res = await deliverLane({ ...input, delivery: "branch" }, deps);

    expect(res).toEqual({ mode: "branch", delivered: false, reason: null });
    expect(mocks.getLane).not.toHaveBeenCalled();
    expect(mocks.land).not.toHaveBeenCalled();
    expect(mocks.openPr).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
    expect(mocks.noteRefusal).not.toHaveBeenCalled();
    expect(mocks.noteUnverified).not.toHaveBeenCalled();
  });

  it("treats a null column and an unknown value the same way — as branch", async () => {
    for (const delivery of [null, undefined, "merge", "LAND"]) {
      const res = await deliverLane({ ...input, delivery }, deps);
      expect(res.mode).toBe("branch");
    }
    expect(mocks.land).not.toHaveBeenCalled();
    expect(mocks.openPr).not.toHaveBeenCalled();
  });
});

describe("land", () => {
  it("fast-forwards the lane's branch and logs the outcome", async () => {
    const res = await deliverLane({ ...input, delivery: "land" }, deps);

    expect(mocks.land).toHaveBeenCalledWith("C:/work/web", "ascent/loop-20260830-acme-web");
    expect(res.delivered).toBe(true);
    expect(mocks.log).toHaveBeenCalledWith("lane-1", "Landed it.");
    expect(mocks.noteRefusal).not.toHaveBeenCalled();
  });

  it("records a lesson when the land is REFUSED, so the operator learns why without reading a diff", async () => {
    mocks.land.mockResolvedValue({
      landed: false,
      refusal: "uncommitted",
      into: "main",
      reason: "Not landing …: it would overwrite 1 file(s) you have uncommitted changes in (README.md). Nothing was touched.",
    } satisfies LandOutcome);

    const res = await deliverLane({ ...input, delivery: "land" }, deps);

    expect(res.delivered).toBe(false);
    expect(mocks.log).toHaveBeenCalledWith("lane-1", expect.stringContaining("Nothing was touched"));
    expect(mocks.noteRefusal).toHaveBeenCalledWith("acme", "acme/web", expect.stringContaining("uncommitted changes"));
  });

  it("does NOT record a lesson for an already-contained branch — a no-op is not a refusal to explain", async () => {
    mocks.land.mockResolvedValue({ landed: false, refusal: "already", into: "main", reason: "already contained" } satisfies LandOutcome);

    await deliverLane({ ...input, delivery: "land" }, deps);

    expect(mocks.log).toHaveBeenCalled();
    expect(mocks.noteRefusal).not.toHaveBeenCalled();
  });

  it("skips a lane that committed nothing, and one with no branch", async () => {
    mocks.getLane.mockResolvedValueOnce(lane({ commits: 0 }));
    expect((await deliverLane({ ...input, delivery: "land" }, deps)).reason).toBeNull();
    mocks.getLane.mockResolvedValueOnce(lane({ branch: null }));
    expect((await deliverLane({ ...input, delivery: "land" }, deps)).reason).toBeNull();
    expect(mocks.land).not.toHaveBeenCalled();
  });

  it("never throws — a thrown git seam becomes a logged outcome, not a failed run", async () => {
    mocks.land.mockRejectedValue(new Error("git is missing"));

    const res = await deliverLane({ ...input, delivery: "land" }, deps);

    expect(res.delivered).toBe(false);
    expect(mocks.log).toHaveBeenCalledWith("lane-1", expect.stringContaining("git is missing"));
  });
});

describe("pr", () => {
  it("reuses the existing lane-PR path, with the lane record and the paired clone", async () => {
    const res = await deliverLane({ ...input, delivery: "pr" }, deps);

    expect(mocks.openPr).toHaveBeenCalledWith(
      expect.objectContaining({ orgSlug: "acme", orgId: "org-1", pairedPath: "C:/work/web", actor: "octocat" }),
    );
    expect(res.delivered).toBe(true);
    expect(mocks.log).toHaveBeenCalledWith("lane-1", expect.stringContaining("PR #7"));
  });

  it("is HONESTLY UNAVAILABLE without a GitHub App — refused and said, never a silent branch", async () => {
    mocks.appConfigured.mockReturnValue(false);

    const res = await deliverLane({ ...input, delivery: "pr" }, deps);

    expect(mocks.openPr).not.toHaveBeenCalled();
    expect(res.delivered).toBe(false);
    expect(res.reason).toContain("no GitHub App configured");
    expect(mocks.log).toHaveBeenCalledWith("lane-1", expect.stringContaining("no GitHub App configured"));
  });

  it("carries the PR path's own refusal message through to the lane log", async () => {
    mocks.openPr.mockRejectedValue(Object.assign(new Error("x"), { body: "Could not push: non-fast-forward." }));

    const res = await deliverLane({ ...input, delivery: "pr" }, deps);

    expect(res.delivered).toBe(false);
    expect(mocks.log).toHaveBeenCalledWith("lane-1", expect.stringContaining("non-fast-forward"));
  });
});

describe("a lane the degradation guard REJECTED", () => {
  it("is never LANDED, whatever mode the run asked for", async () => {
    // The guard already stops such a lane before it commits, so in practice `commits === 0` would
    // turn it away — but "in practice" is not the standard for the one path that merges into a
    // working copy. The verdict is checked explicitly, and it is checked FIRST.
    mocks.getLane.mockResolvedValue(lane({ verifyVerdict: "rejected", commits: 2 }));

    const res = await deliverLane({ ...input, delivery: "land" }, deps);

    expect(mocks.land).not.toHaveBeenCalled();
    expect(res.delivered).toBe(false);
    expect(res.reason).toContain("degradation guard rejected");
    expect(mocks.log).toHaveBeenCalledWith("lane-1", expect.stringContaining("never landed and never opened as a PR"));
  });

  it("never opens a PR either", async () => {
    mocks.getLane.mockResolvedValue(lane({ verifyVerdict: "rejected", commits: 2 }));

    const res = await deliverLane({ ...input, delivery: "pr" }, deps);

    expect(mocks.openPr).not.toHaveBeenCalled();
    expect(res.delivered).toBe(false);
  });

  it("is refused for the SAME reason whether the guard was armed or not", async () => {
    // `rejected` cannot occur with the guard off, but the veto does not read the dial: a lane
    // carrying that verdict is refused on the verdict alone.
    mocks.getLane.mockResolvedValue(lane({ verifyVerdict: "rejected", commits: 2 }));

    const res = await deliverLane({ ...input, delivery: "land", verifyMode: "off" }, deps);

    expect(mocks.land).not.toHaveBeenCalled();
    expect(res.reason).toContain("degradation guard rejected");
  });
});

// ── THE RULE THIS FILE EXISTS FOR SINCE run a97baf88 ────────────────────────────────────────────
//
// The operator turned verification ON. That is a request that changes be CHECKED before they reach
// their branch. Three of the four verdicts — and the absent one — mean the check could not be MADE,
// which is not permission to land. Gating on `rejected` alone is what let three cycles of
// `baseline-red` work land into a real working branch on 2026-08-30.
describe("verification the operator asked for", () => {
  const unverifiable = ["baseline-red", "skipped", null] as const;

  it("delivers by LAND only on `verified`", async () => {
    for (const verdict of unverifiable) {
      mocks.land.mockClear();
      mocks.log.mockClear();
      mocks.noteUnverified.mockClear();
      mocks.getLane.mockResolvedValue(lane({ verifyVerdict: verdict, commits: 2 }));

      const res = await deliverLane({ ...input, delivery: "land", verifyMode: "on" }, deps);

      expect(mocks.land, `${verdict} was landed`).not.toHaveBeenCalled();
      expect(res.delivered).toBe(false);
      // THE LOG NAMES THE VERDICT. "It committed but nothing moved" is otherwise indistinguishable
      // from a bug, which is exactly how the live run read.
      expect(res.reason).toContain("verifyMode: on");
      expect(mocks.log).toHaveBeenCalledWith("lane-1", expect.stringContaining("Not landing"));
      // One standing lesson per CAUSE — the reason sentence is branch-free and run-free.
      expect(mocks.noteUnverified).toHaveBeenCalledWith("acme", "acme/web", expect.any(String));
    }

    mocks.getLane.mockResolvedValue(lane({ verifyVerdict: "verified", commits: 2 }));
    const ok = await deliverLane({ ...input, delivery: "land", verifyMode: "on" }, deps);
    expect(ok.delivered).toBe(true);
    expect(mocks.land).toHaveBeenCalledTimes(1);
  });

  it("opens a PR only on `verified`", async () => {
    for (const verdict of unverifiable) {
      mocks.openPr.mockClear();
      mocks.getLane.mockResolvedValue(lane({ verifyVerdict: verdict, commits: 2 }));

      const res = await deliverLane({ ...input, delivery: "pr", verifyMode: "on" }, deps);

      expect(mocks.openPr, `${verdict} was published`).not.toHaveBeenCalled();
      expect(res.reason).toContain("Not opening a PR for");
    }

    mocks.getLane.mockResolvedValue(lane({ verifyVerdict: "verified", commits: 2 }));
    expect((await deliverLane({ ...input, delivery: "pr", verifyMode: "on" }, deps)).delivered).toBe(true);
  });

  it("says WHICH verdict held the work back, per verdict", async () => {
    const said: Record<string, string> = {};
    for (const verdict of unverifiable) {
      mocks.getLane.mockResolvedValue(lane({ verifyVerdict: verdict, commits: 2 }));
      said[String(verdict)] = (await deliverLane({ ...input, delivery: "land", verifyMode: "on" }, deps)).reason ?? "";
    }
    expect(said["baseline-red"]).toContain("already failing");
    expect(said["skipped"]).toContain("no command could be resolved");
    expect(said["null"]).toContain("no verification verdict");
  });

  it("changes NOTHING when the operator turned the guard off — only `rejected` blocks", async () => {
    for (const verdict of [...unverifiable, "verified"] as const) {
      mocks.land.mockClear();
      mocks.noteUnverified.mockClear();
      mocks.getLane.mockResolvedValue(lane({ verifyVerdict: verdict, commits: 2 }));

      await deliverLane({ ...input, delivery: "land", verifyMode: "off" }, deps);

      expect(mocks.land, `${verdict} was refused with the guard off`).toHaveBeenCalledTimes(1);
      expect(mocks.noteUnverified).not.toHaveBeenCalled();
    }
  });

  it("treats an unrecorded dial as ON — the guard is the default posture", async () => {
    mocks.getLane.mockResolvedValue(lane({ verifyVerdict: "baseline-red", commits: 2 }));

    for (const verifyMode of [null, undefined, "nonsense"]) {
      mocks.land.mockClear();
      await deliverLane({ ...input, delivery: "land", verifyMode }, deps);
      expect(mocks.land).not.toHaveBeenCalled();
    }
  });

  it("stays silent about a lane that committed nothing — there is nothing to hold back", async () => {
    mocks.getLane.mockResolvedValue(lane({ verifyVerdict: "baseline-red", commits: 0 }));

    const res = await deliverLane({ ...input, delivery: "land", verifyMode: "on" }, deps);

    expect(res.reason).toBeNull();
    expect(mocks.log).not.toHaveBeenCalled();
    expect(mocks.noteUnverified).not.toHaveBeenCalled();
  });
});
