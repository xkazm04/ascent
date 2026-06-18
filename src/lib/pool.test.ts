// Pins the bounded-concurrency engine (`mapPool`) under every fleet scan path (org/import, org/scan,
// cron/rescan). A regression here double-bills or silently skips repos across the whole fleet, so the
// three documented contracts — exactly-once, input-order results, in-flight cap — plus the "fn owns
// its errors" footgun are verified here with deterministic deferred promises (no real timers/sleeps).

import { describe, it, expect } from "vitest";
import { mapPool, SCAN_CONCURRENCY } from "./pool";

/** A promise whose resolve/reject is exposed so the test drives completion order, not the clock. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Yield to the microtask queue enough times for any pending lane scheduling to settle. */
async function flush(times = 5) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe("mapPool", () => {
  describe("empty input", () => {
    it("returns [] and never invokes fn", async () => {
      let calls = 0;
      const out = await mapPool([], 4, async () => {
        calls++;
        return 1;
      });
      expect(out).toEqual([]);
      expect(calls).toBe(0);
    });

    it("returns an array, not undefined, for an empty list", async () => {
      const out = await mapPool<number, number>([], 4, async (x) => x);
      expect(Array.isArray(out)).toBe(true);
      expect(out).toHaveLength(0);
    });
  });

  describe("order preservation", () => {
    it("maps results to inputs in INPUT order even when later items resolve first", async () => {
      const items = [0, 1, 2, 3];
      const defs = items.map(() => deferred<string>());
      const seenIndices: number[] = [];

      const poolPromise = mapPool(items, 4, async (item, index) => {
        seenIndices.push(index);
        return defs[index]!.promise;
      });

      // Let all 4 lanes start (concurrency >= n so every item is in flight).
      await flush();

      // Resolve in REVERSE order — completion order is the opposite of input order.
      defs[3]!.resolve("r3");
      defs[2]!.resolve("r2");
      defs[1]!.resolve("r1");
      defs[0]!.resolve("r0");

      const out = await poolPromise;
      // results[i] corresponds to items[i] regardless of which finished first.
      expect(out).toEqual(["r0", "r1", "r2", "r3"]);
    });

    it("equals items.map(fn) for a simple synchronous-async fn", async () => {
      const items = [10, 20, 30, 40, 50];
      const out = await mapPool(items, 2, async (x) => x * 2);
      expect(out).toEqual([20, 40, 60, 80, 100]);
    });

    it("passes the correct index alongside each item", async () => {
      const items = ["a", "b", "c"];
      const out = await mapPool(items, 3, async (item, index) => `${index}:${item}`);
      expect(out).toEqual(["0:a", "1:b", "2:c"]);
    });
  });

  describe("exactly-once", () => {
    it("invokes fn once per index; total invocations === items.length; output length matches", async () => {
      const items = Array.from({ length: 17 }, (_, i) => i);
      const callCount = new Map<number, number>();
      let total = 0;

      const out = await mapPool(items, 4, async (item, index) => {
        total++;
        callCount.set(index, (callCount.get(index) ?? 0) + 1);
        return item;
      });

      expect(total).toBe(items.length);
      expect(out).toHaveLength(items.length);
      // Every index invoked exactly once — none dropped, none duplicated.
      for (const i of items) {
        expect(callCount.get(i)).toBe(1);
      }
      expect(callCount.size).toBe(items.length);
      // And the values round-trip in order, so no item was silently swapped or skipped.
      expect(out).toEqual(items);
    });

    it("processes every item exactly once when concurrency exceeds item count", async () => {
      const items = [1, 2, 3];
      let total = 0;
      const out = await mapPool(items, 100, async (x) => {
        total++;
        return x;
      });
      expect(total).toBe(3);
      expect(out).toEqual([1, 2, 3]);
    });

    it("processes every item exactly once with concurrency of 1 (fully serial)", async () => {
      const items = [1, 2, 3, 4, 5];
      const order: number[] = [];
      const out = await mapPool(items, 1, async (x) => {
        order.push(x);
        return x;
      });
      // Serial lane processes strictly in input order.
      expect(order).toEqual([1, 2, 3, 4, 5]);
      expect(out).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe("concurrency cap", () => {
    it("never exceeds min(concurrency, n) in flight and actually parallelizes (peak > 1)", async () => {
      const items = Array.from({ length: 10 }, (_, i) => i);
      const concurrency = 3;
      const defs = items.map(() => deferred<number>());

      let live = 0;
      let peak = 0;

      const poolPromise = mapPool(items, concurrency, async (item, index) => {
        live++;
        if (live > peak) peak = live;
        await defs[index]!.promise;
        live--;
        return item;
      });

      // Drain lanes deterministically: resolve one item, let a lane claim the next, repeat.
      // At every settle point the live counter must stay within the cap.
      for (let i = 0; i < items.length; i++) {
        await flush();
        expect(live).toBeLessThanOrEqual(concurrency);
        defs[i]!.resolve(i);
      }

      const out = await poolPromise;
      expect(out).toEqual(items);
      // Observed peak is exactly the cap (3 lanes), proving real parallelism, never over-subscribed.
      expect(peak).toBe(concurrency);
      expect(peak).toBeGreaterThan(1);
    });

    it("caps in-flight at n when concurrency > n (lanes clamped to item count)", async () => {
      const items = [0, 1, 2];
      const defs = items.map(() => deferred<number>());
      let live = 0;
      let peak = 0;

      const poolPromise = mapPool(items, 10, async (item, index) => {
        live++;
        if (live > peak) peak = live;
        await defs[index]!.promise;
        live--;
        return item;
      });

      await flush();
      // All 3 items in flight at once, but never more than 3 lanes exist (min(10, 3) === 3).
      expect(live).toBe(3);
      expect(peak).toBe(3);

      defs.forEach((d, i) => d.resolve(i));
      const out = await poolPromise;
      expect(out).toEqual(items);
      expect(peak).toBe(3);
    });

    it("treats concurrency <= 0 as a single lane (Math.max(1, ...) floor), staying serial", async () => {
      const items = [0, 1, 2, 3];
      const defs = items.map(() => deferred<number>());
      let live = 0;
      let peak = 0;

      const poolPromise = mapPool(items, 0, async (item, index) => {
        live++;
        if (live > peak) peak = live;
        await defs[index]!.promise;
        live--;
        return item;
      });

      // Drive one item at a time; with a single lane only one is ever live.
      for (let i = 0; i < items.length; i++) {
        await flush();
        expect(live).toBe(1);
        defs[i]!.resolve(i);
      }

      const out = await poolPromise;
      expect(out).toEqual(items);
      expect(peak).toBe(1);
    });
  });

  describe("error handling contract", () => {
    it("rejects the whole pool when fn throws (fn must own its errors)", async () => {
      const items = [0, 1, 2, 3];
      await expect(
        mapPool(items, 2, async (item) => {
          if (item === 2) throw new Error("boom on item 2");
          return item;
        }),
      ).rejects.toThrow("boom on item 2");
    });

    it("propagates a rejected promise from fn", async () => {
      const items = [0, 1];
      await expect(
        mapPool(items, 1, async (item) => {
          if (item === 1) return Promise.reject(new Error("rejected item 1"));
          return item;
        }),
      ).rejects.toThrow("rejected item 1");
    });

    it("a throw does not corrupt exactly-once accounting (no item runs twice before the abort)", async () => {
      const items = [0, 1, 2, 3, 4, 5];
      const callCount = new Map<number, number>();

      const poolPromise = mapPool(items, 2, async (item, index) => {
        callCount.set(index, (callCount.get(index) ?? 0) + 1);
        if (item === 0) throw new Error("fail fast");
        return item;
      });

      await expect(poolPromise).rejects.toThrow("fail fast");
      // No index was invoked more than once — the failing lane does not retry or re-claim.
      for (const count of callCount.values()) {
        expect(count).toBe(1);
      }
    });
  });

  describe("SCAN_CONCURRENCY export", () => {
    it("is the documented bounded default of 4", () => {
      expect(SCAN_CONCURRENCY).toBe(4);
    });
  });
});
