// The push rescan's enqueue-and-drain (push-triggered-rescan part 2). Pinned here:
//   • the window bucket — one bucket per ALIGNED window, a new one at the boundary, and per delivery
//     when the throttle is off;
//   • the enqueue arguments and the by-id, deadline-bounded drain;
//   • the delivery contract: no row → { enqueued: false } (the caller releases the delivery); a row →
//     enqueued, even when the drain throws (the row is the durable record).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  enqueueScanJob: vi.fn(),
  drainLane: vi.fn(),
  reportHandledError: vi.fn(),
}));

vi.mock("@/lib/db/scan-jobs", () => ({
  enqueueScanJob: h.enqueueScanJob,
  JOB_PRIORITY: { manual: 10, webhook: 5, cadence: 0 },
}));
vi.mock("@/lib/scan-queue-worker", () => ({ drainLane: h.drainLane, PUSH_JOB_REASON: "webhook:push" }));
vi.mock("@/lib/api/respond", () => ({ reportHandledError: h.reportHandledError }));

import { enqueueAndDrainPushRescan, pushRescanBucket, pushRescanMinIntervalMs } from "./push-rescan";

const W = 15 * 60_000;

describe("pushRescanBucket", () => {
  it("is one bucket per aligned window, and the next window starts a new one at the boundary", () => {
    const k = 1_950_000; // an arbitrary window index
    expect(pushRescanBucket(k * W, W, "d1")).toBe(`push:${k}`);
    expect(pushRescanBucket(k * W + W - 1, W, "d2")).toBe(`push:${k}`);
    expect(pushRescanBucket(k * W + W, W, "d3")).toBe(`push:${k + 1}`);
    expect(pushRescanBucket(k * W - 1, W, "d4")).toBe(`push:${k - 1}`);
  });

  it("with the throttle off (0) the bucket is the delivery id, or now without one", () => {
    expect(pushRescanBucket(123_456, 0, "delivery-1")).toBe("push:delivery-1");
    expect(pushRescanBucket(123_456, 0)).toBe("push:123456");
  });
});

describe("pushRescanMinIntervalMs", () => {
  afterEach(() => {
    delete process.env.PUSH_RESCAN_MIN_INTERVAL_MINUTES;
  });

  it("defaults to 15 minutes, honors the env, allows 0, and ignores garbage", () => {
    expect(pushRescanMinIntervalMs()).toBe(W);
    process.env.PUSH_RESCAN_MIN_INTERVAL_MINUTES = "60";
    expect(pushRescanMinIntervalMs()).toBe(60 * 60_000);
    process.env.PUSH_RESCAN_MIN_INTERVAL_MINUTES = "0";
    expect(pushRescanMinIntervalMs()).toBe(0);
    process.env.PUSH_RESCAN_MIN_INTERVAL_MINUTES = "-5";
    expect(pushRescanMinIntervalMs()).toBe(W);
    process.env.PUSH_RESCAN_MIN_INTERVAL_MINUTES = "soon";
    expect(pushRescanMinIntervalMs()).toBe(W);
  });
});

describe("enqueueAndDrainPushRescan", () => {
  const NOW = 1_950_000 * W + 7 * 60_000;
  const input = { orgSlug: "acme", fullName: "acme/api", deliveryId: "d1", invokedAt: NOW - 1_000, maxDurationSec: 300, now: NOW };
  const summary = { claimed: 1, done: 1, failed: 0, skipped: 0, skippedForCredits: 0, skippedNoToken: 0, truncated: false, errors: [] };

  beforeEach(() => {
    for (const fn of Object.values(h)) fn.mockReset();
    h.enqueueScanJob.mockResolvedValue({ id: "job_1", created: true });
    h.drainLane.mockResolvedValue(summary);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("enqueues a webhook:push rescore job in the window bucket and drains exactly it, by id, with a deadline", async () => {
    const res = await enqueueAndDrainPushRescan(input);
    expect(h.enqueueScanJob).toHaveBeenCalledWith({
      orgSlug: "acme",
      repoFullName: "acme/api",
      lane: "rescore",
      reason: "webhook:push",
      bucket: "push:1950000",
      priority: 5,
    });
    expect(h.drainLane).toHaveBeenCalledWith("rescore", {
      jobs: [{ id: "job_1", repo: "acme/api" }],
      concurrency: 1,
      deadlineAt: NOW - 1_000 + 300_000 - 15_000,
      orgSlug: "acme",
      workerId: "webhook:d1",
    });
    expect(res).toEqual({ enqueued: true, jobId: "job_1", created: true, summary });
  });

  it("a null enqueue is reported and answers enqueued: false, with no drain", async () => {
    h.enqueueScanJob.mockResolvedValueOnce(null);
    expect(await enqueueAndDrainPushRescan(input)).toEqual({ enqueued: false });
    expect(h.reportHandledError).toHaveBeenCalledWith(expect.any(Error), { message: "push rescan enqueue returned no row" });
    expect(console.error).toHaveBeenCalledWith("[webhook] push rescan enqueue returned no row for acme/api", "enqueueScanJob returned null");
    expect(h.drainLane).not.toHaveBeenCalled();
  });

  it("a thrown enqueue is reported and answers enqueued: false, with no drain", async () => {
    const err = new Error("write failed");
    h.enqueueScanJob.mockRejectedValueOnce(err);
    expect(await enqueueAndDrainPushRescan(input)).toEqual({ enqueued: false });
    expect(h.reportHandledError).toHaveBeenCalledWith(err, { message: "push rescan enqueue failed" });
    expect(h.drainLane).not.toHaveBeenCalled();
  });

  it("a drain that throws is reported, but the job row stands: still enqueued", async () => {
    const err = new Error("reserve threw");
    h.drainLane.mockRejectedValueOnce(err);
    expect(await enqueueAndDrainPushRescan(input)).toEqual({ enqueued: true, jobId: "job_1", created: true, summary: null });
    expect(h.reportHandledError).toHaveBeenCalledWith(err, { message: "push rescan drain failed" });
  });

  it("a second push in the same window finds the row (created: false) and is still enqueued", async () => {
    h.enqueueScanJob.mockResolvedValueOnce({ id: "job_1", created: false });
    const res = await enqueueAndDrainPushRescan({ ...input, deliveryId: "d2", now: NOW + 60_000 });
    expect(h.enqueueScanJob.mock.calls[0]![0].bucket).toBe("push:1950000");
    expect(res).toMatchObject({ enqueued: true, jobId: "job_1", created: false });
  });
});
