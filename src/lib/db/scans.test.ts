import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { isUniqueConstraintError, upsertRacing, withRepoLock } from "@/lib/db/scans";

// These cover the concurrency-safety primitives behind persistScanReport without touching a real
// database — the persist path itself is exercised by the e2e suite.

const p2002 = () =>
  new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });

describe("isUniqueConstraintError", () => {
  it("is true only for a P2002 known-request error", () => {
    expect(isUniqueConstraintError(p2002())).toBe(true);
    expect(
      isUniqueConstraintError(
        new Prisma.PrismaClientKnownRequestError("Not found", { code: "P2025", clientVersion: "test" }),
      ),
    ).toBe(false);
    expect(isUniqueConstraintError(new Error("unique constraint violated"))).toBe(false);
    expect(isUniqueConstraintError(null)).toBe(false);
    expect(isUniqueConstraintError({ code: "P2002" })).toBe(false); // not a Prisma error instance
  });
});

describe("upsertRacing", () => {
  it("returns the upsert result and never reads back when there is no conflict", async () => {
    let conflictCalls = 0;
    const result = await upsertRacing(
      async () => "created",
      async () => {
        conflictCalls++;
        return "reread";
      },
    );
    expect(result).toBe("created");
    expect(conflictCalls).toBe(0);
  });

  it("recovers via onConflict on a P2002 (lost the create race)", async () => {
    const result = await upsertRacing(
      async () => {
        throw p2002();
      },
      async () => "reread",
    );
    expect(result).toBe("reread");
  });

  it("re-throws a non-P2002 error without attempting recovery", async () => {
    let conflictCalls = 0;
    await expect(
      upsertRacing(
        async () => {
          throw new Error("connection reset");
        },
        async () => {
          conflictCalls++;
          return "reread";
        },
      ),
    ).rejects.toThrow("connection reset");
    expect(conflictCalls).toBe(0);
  });
});

describe("withRepoLock", () => {
  it("serializes same-key runs in arrival order (no overlap)", async () => {
    const events: string[] = [];
    const task = (id: string) => async () => {
      events.push(`start:${id}`);
      // Yield a couple of microtasks to give any racing task a chance to interleave (it must not).
      await Promise.resolve();
      await Promise.resolve();
      events.push(`end:${id}`);
      return id;
    };

    const a = withRepoLock("repo", task("A"));
    const b = withRepoLock("repo", task("B"));
    expect(await Promise.all([a, b])).toEqual(["A", "B"]);
    expect(events).toEqual(["start:A", "end:A", "start:B", "end:B"]);
  });

  it("runs different keys concurrently", async () => {
    const order: string[] = [];
    let releaseA = () => {};
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });

    const a = withRepoLock("a", async () => {
      order.push("A:start");
      await gateA; // hold the "a" lane open
      order.push("A:end");
    });
    const b = withRepoLock("b", async () => {
      order.push("B:start");
      order.push("B:end");
    });

    await b; // B (different key) completes while A is still gated -> proves they don't serialize
    expect(order).toEqual(["A:start", "B:start", "B:end"]);

    releaseA();
    await a;
    expect(order).toEqual(["A:start", "B:start", "B:end", "A:end"]);
  });

  it("a failed run does not wedge the queue for its key", async () => {
    const failed = withRepoLock("k", async () => {
      throw new Error("boom");
    });
    await expect(failed).rejects.toThrow("boom");

    const next = withRepoLock("k", async () => "recovered");
    await expect(next).resolves.toBe("recovered");
  });

  it("propagates each run's own result/rejection to its own caller", async () => {
    const ok = withRepoLock("k2", async () => 42);
    const bad = withRepoLock("k2", async () => {
      throw new Error("second fails");
    });
    const ok2 = withRepoLock("k2", async () => 7);

    expect(await ok).toBe(42);
    await expect(bad).rejects.toThrow("second fails");
    expect(await ok2).toBe(7);
  });
});
