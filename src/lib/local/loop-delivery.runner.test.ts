// DELIVERY `runner` — the standing runner's mode — and `landedAt`, with every seam injected.
//
// The runner fast-forwards `ascent/runner` to each VERIFIED lane that committed, under exactly the
// rules `land` follows (a rejected lane never, an unverified one never while the guard is on). A lane
// is stamped `landedAt` only when its branch really reached a branch the next lane builds on — the
// runner branch, or the operator's own under `land` — never on a refusal.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { deliverLane, type DeliverDeps } from "./loop-delivery";
import type { LandOutcome } from "./loop-land";
import type { LoopLaneRecord } from "@/lib/db/loop-runs-types";

const lane = (over: Partial<LoopLaneRecord> = {}): LoopLaneRecord =>
  ({ id: "lane-1", repoFullName: "acme/web", branch: "ascent/loop-1-acme-web", commits: 2, verifyVerdict: "verified", ...over }) as LoopLaneRecord;

let mocks: Record<keyof DeliverDeps, ReturnType<typeof vi.fn>>;
const deps = () => mocks as unknown as DeliverDeps;
const input = { orgSlug: "acme", orgId: "org-1", laneId: "lane-1", pairedPath: "C:/work/web", actor: "octocat" };

beforeEach(() => {
  mocks = {
    land: vi.fn(async (): Promise<LandOutcome> => ({ landed: true, refusal: null, into: "main", reason: "Landed it." })),
    openPr: vi.fn(),
    appConfigured: vi.fn(() => true),
    getLane: vi.fn(async () => lane()),
    log: vi.fn(async () => null),
    noteRefusal: vi.fn(async () => null),
    noteUnverified: vi.fn(async () => null),
    landRunner: vi.fn(async () => ({ ok: true, sha: "b".repeat(40), note: "Landed ascent/loop-1-acme-web on ascent/runner." })),
    markLanded: vi.fn(async () => null),
  };
});

describe("runner delivery", () => {
  it("fast-forwards the runner branch to a verified lane, logs it, and stamps landedAt", async () => {
    const res = await deliverLane({ ...input, delivery: "runner", verifyMode: "on" }, deps());
    expect(mocks.landRunner).toHaveBeenCalledWith("C:/work/web", "ascent/loop-1-acme-web");
    expect(res).toMatchObject({ mode: "runner", delivered: true });
    expect(mocks.log).toHaveBeenCalledWith("lane-1", expect.stringContaining("ascent/runner"));
    expect(mocks.markLanded).toHaveBeenCalledWith("lane-1");
    // It is never the operator's branch: neither `land` nor a PR is touched.
    expect(mocks.land).not.toHaveBeenCalled();
    expect(mocks.openPr).not.toHaveBeenCalled();
  });

  it("a refused (non-fast-forward) land is logged, never forced, and leaves landedAt unset", async () => {
    mocks.landRunner.mockResolvedValueOnce({ ok: false, note: "Not landing: ascent/runner moved on. Nothing was forced." });
    const res = await deliverLane({ ...input, delivery: "runner" }, deps());
    expect(res.delivered).toBe(false);
    expect(mocks.log).toHaveBeenCalledWith("lane-1", expect.stringContaining("Nothing was forced"));
    expect(mocks.markLanded).not.toHaveBeenCalled();
    expect(mocks.noteRefusal).not.toHaveBeenCalled();
  });

  it("a throwing git seam is a logged refusal, not a failed run", async () => {
    mocks.landRunner.mockRejectedValueOnce(new Error("git exploded"));
    const res = await deliverLane({ ...input, delivery: "runner" }, deps());
    expect(res).toMatchObject({ delivered: false, reason: expect.stringContaining("git exploded") });
  });

  it.each(["baseline-unavailable", "skipped", null])("never lands an UNVERIFIED lane (%s) while the guard is on", async (verdict) => {
    mocks.getLane.mockResolvedValueOnce(lane({ verifyVerdict: verdict as LoopLaneRecord["verifyVerdict"] }));
    const res = await deliverLane({ ...input, delivery: "runner", verifyMode: "on" }, deps());
    expect(res.delivered).toBe(false);
    expect(mocks.landRunner).not.toHaveBeenCalled();
    expect(mocks.markLanded).not.toHaveBeenCalled();
  });

  it("never lands a REJECTED lane, nor one that committed nothing", async () => {
    mocks.getLane.mockResolvedValueOnce(lane({ verifyVerdict: "rejected" }));
    await deliverLane({ ...input, delivery: "runner" }, deps());
    mocks.getLane.mockResolvedValueOnce(lane({ commits: 0 }));
    await deliverLane({ ...input, delivery: "runner" }, deps());
    expect(mocks.landRunner).not.toHaveBeenCalled();
  });
});

describe("landedAt under `land` — the same meaning", () => {
  it("is stamped when the lane landed in the operator's branch", async () => {
    await deliverLane({ ...input, delivery: "land" }, deps());
    expect(mocks.markLanded).toHaveBeenCalledWith("lane-1");
  });

  it("is not stamped on a refusal or an already-contained branch", async () => {
    mocks.land.mockResolvedValueOnce({ landed: false, refusal: "diverged", reason: "diverged" });
    await deliverLane({ ...input, delivery: "land" }, deps());
    mocks.land.mockResolvedValueOnce({ landed: false, refusal: "already", reason: "already" });
    await deliverLane({ ...input, delivery: "land" }, deps());
    expect(mocks.markLanded).not.toHaveBeenCalled();
  });

  it("`branch` still reads and writes nothing — not even landedAt", async () => {
    await deliverLane({ ...input, delivery: "branch" }, deps());
    expect(mocks.getLane).not.toHaveBeenCalled();
    expect(mocks.markLanded).not.toHaveBeenCalled();
    expect(mocks.landRunner).not.toHaveBeenCalled();
  });
});
