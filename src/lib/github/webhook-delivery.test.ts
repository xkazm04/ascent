// Unit coverage for the extracted webhook replay-cache + abort-and-retry helpers (pulled out of
// src/app/api/app/webhook/route.ts). Mirrors the TTL/eviction invariants the route's own test
// suite pins at a higher level (route.test.ts's "replay-dedup window" describe block), but here
// against the real exported functions instead of route-local mirrors of the constants.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({
  releaseWebhookDelivery: vi.fn(async () => {}),
}));

import { abandonDelivery, deliveryAlreadySeen, forgetDelivery, forgetLocalDelivery } from "./webhook-delivery";
import { releaseWebhookDelivery } from "@/lib/db";

const mockRelease = vi.mocked(releaseWebhookDelivery);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  mockRelease.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("deliveryAlreadySeen", () => {
  it("returns false the first time an id is seen, true on an immediate replay", () => {
    expect(deliveryAlreadySeen("d1")).toBe(false);
    expect(deliveryAlreadySeen("d1")).toBe(true);
  });

  it("treats a distinct id as unseen", () => {
    expect(deliveryAlreadySeen("d2")).toBe(false);
    expect(deliveryAlreadySeen("d3")).toBe(false);
  });

  it("expires an entry after the 10-minute TTL, allowing reprocessing", () => {
    expect(deliveryAlreadySeen("ttl-1")).toBe(false);
    vi.setSystemTime(11 * 60_000); // past the 10-min TTL
    expect(deliveryAlreadySeen("ttl-1")).toBe(false); // expired -> treated as fresh, re-recorded
  });

  it("still dedupes within the TTL window", () => {
    expect(deliveryAlreadySeen("ttl-2")).toBe(false);
    vi.setSystemTime(5 * 60_000); // inside the 10-min TTL
    expect(deliveryAlreadySeen("ttl-2")).toBe(true);
  });
});

describe("forgetLocalDelivery", () => {
  it("removes only the in-memory record, without touching the DB claim", () => {
    expect(deliveryAlreadySeen("local-1")).toBe(false);
    forgetLocalDelivery("local-1");
    expect(deliveryAlreadySeen("local-1")).toBe(false); // forgotten -> treated as fresh again
    expect(mockRelease).not.toHaveBeenCalled();
  });
});

describe("forgetDelivery", () => {
  it("removes the in-memory record AND releases the DB claim", async () => {
    expect(deliveryAlreadySeen("full-1")).toBe(false);
    await forgetDelivery("full-1");
    expect(deliveryAlreadySeen("full-1")).toBe(false); // forgotten locally too
    expect(mockRelease).toHaveBeenCalledWith("full-1");
  });
});

describe("abandonDelivery", () => {
  it("runs the log callback before releasing, when a deliveryId is given", async () => {
    const order: string[] = [];
    mockRelease.mockImplementationOnce(async () => {
      order.push("release");
    });
    await abandonDelivery("d-log", () => order.push("log"));
    expect(order).toEqual(["log", "release"]);
  });

  it("still logs when there is no deliveryId, but does not call release", async () => {
    const log = vi.fn();
    await abandonDelivery(undefined, log);
    expect(log).toHaveBeenCalledTimes(1);
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it("is a no-op (no throw) when called with neither a deliveryId nor a log callback", async () => {
    await expect(abandonDelivery(undefined)).resolves.toBeUndefined();
    expect(mockRelease).not.toHaveBeenCalled();
  });
});
