// The poll's concurrency guard, pinned without a renderer: never two reads in flight; a read asked
// for DURING a read gets exactly one fresh read after it (shared by every caller who asked); and the
// clock the chain arms its next tick from.

import { describe, expect, it } from "vitest";
import { serialTicker } from "./serialTick";

/** A read whose every call waits for the test to release it, counting how many are in flight. */
function gatedRead() {
  const releases: (() => void)[] = [];
  const stats = { calls: 0, inFlight: 0, maxInFlight: 0 };
  const read = () => {
    stats.calls += 1;
    stats.inFlight += 1;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    return new Promise<void>((resolve) =>
      releases.push(() => {
        stats.inFlight -= 1;
        resolve();
      }),
    );
  };
  const releaseNext = async () => {
    releases.shift()?.();
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  };
  return { read, stats, releaseNext };
}

describe("serialTicker", () => {
  it("never starts a second read while one is in flight", async () => {
    const g = gatedRead();
    const t = serialTicker(g.read);
    void t.run();
    void t.run();
    void t.run();
    expect(g.stats.calls).toBe(1);
    await g.releaseNext();
    expect(g.stats.maxInFlight).toBe(1);
  });

  it("answers everyone who asked mid-read with ONE fresh read after it, not the stale one", async () => {
    const g = gatedRead();
    const t = serialTicker(g.read);
    void t.run();
    const a = t.run();
    const b = t.run();
    expect(a).toBe(b); // the queued follow-up is shared
    await g.releaseNext(); // the first read settles → exactly one follow-up starts
    expect(g.stats.calls).toBe(2);
    await g.releaseNext();
    await a;
    expect(g.stats.calls).toBe(2);
    expect(g.stats.maxInFlight).toBe(1);
  });

  it("survives a read that throws — the next run still reads", async () => {
    let n = 0;
    const t = serialTicker(async () => {
      n += 1;
      if (n === 1) throw new Error("boom");
    });
    await t.run();
    await t.run();
    expect(n).toBe(2);
  });

  it("reports 0 before any read, `now` while one is in flight, and the settle time after", async () => {
    let clock = 1_000;
    const g = gatedRead();
    const t = serialTicker(g.read, () => clock);
    expect(t.lastAt()).toBe(0);
    void t.run();
    clock = 2_000;
    expect(t.lastAt()).toBe(2_000);
    clock = 3_000;
    await g.releaseNext();
    clock = 9_000;
    expect(t.lastAt()).toBe(3_000);
  });
});
