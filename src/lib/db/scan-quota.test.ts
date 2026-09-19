// Pins transactPublicScanQuota — the data-layer home for the quota bucket's read-decide-write
// (docs/specs/2026-08-30-public-scan-quota-repository.md). The load-bearing facts: the read, the
// decide, and the conditional upsert all run inside ONE $transaction; the isolation options are
// selected per driver (Postgres ⇒ Serializable so a racer aborts with 40001; DSQL ⇒ none, its
// native OCC already aborts the loser); a decide that returns no window writes NOTHING; and the
// whole closure sits under withRetry with the caller's label. The policy-level behavior (window
// math, fail-open, refund keying) stays pinned in src/lib/public-scan-quota.test.ts, which runs
// its consume/refund suites through THIS real function.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Prisma } from "@prisma/client";

const { mockReadDsqlConfig, mockWithRetry } = vi.hoisted(() => ({
  mockReadDsqlConfig: vi.fn(() => null as unknown), // null = Postgres by default
  mockWithRetry: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock("@/lib/db/client", () => ({
  readDsqlConfig: mockReadDsqlConfig,
  withDb: (op: (db: unknown) => unknown) => op(currentDb),
  withRetry: mockWithRetry,
}));

import { transactPublicScanQuota } from "./scan-quota";

let currentDb: { $transaction: (fn: (tx: unknown) => unknown, opts?: unknown) => unknown };
let capturedTxOptions: unknown;

/** A fake client over one in-memory row store; $transaction records the options it was passed. */
function makeFakeDb(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
  const tx = {
    publicScanQuota: {
      findUnique: vi.fn(async ({ where }: { where: { ipHash: string } }) =>
        store.has(where.ipHash) ? { ipHash: where.ipHash, hits: store.get(where.ipHash)! } : null,
      ),
      upsert: vi.fn(
        async ({ where, create, update }: { where: { ipHash: string }; create: { hits: string }; update: { hits: string } }) => {
          store.set(where.ipHash, store.has(where.ipHash) ? update.hits : create.hits);
        },
      ),
    },
  };
  const db = {
    $transaction: (fn: (t: typeof tx) => unknown, opts?: unknown) => {
      capturedTxOptions = opts;
      return fn(tx);
    },
  };
  return { db, store, tx };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReadDsqlConfig.mockReturnValue(null);
  capturedTxOptions = undefined;
});

describe("transactPublicScanQuota — read-decide-write in one transaction", () => {
  it("hands decide the stored raw hits and upserts the returned window on the SAME tx", async () => {
    const { db, store, tx } = makeFakeDb({ bucket1: "[1,2]" });
    currentDb = db;

    const seen: (string | null)[] = [];
    const out = await transactPublicScanQuota("bucket1", "test-op", (raw) => {
      seen.push(raw);
      return { hits: "[1,2,3]", result: "charged" };
    });

    expect(out).toBe("charged");
    expect(seen).toEqual(["[1,2]"]);
    expect(tx.publicScanQuota.findUnique).toHaveBeenCalledWith({ where: { ipHash: "bucket1" } });
    expect(tx.publicScanQuota.upsert).toHaveBeenCalledTimes(1);
    expect(store.get("bucket1")).toBe("[1,2,3]");
  });

  it("hands decide null for a missing row, and the upsert CREATES the bucket", async () => {
    const { db, store } = makeFakeDb();
    currentDb = db;

    const out = await transactPublicScanQuota("fresh", "test-op", (raw) => {
      expect(raw).toBeNull();
      return { hits: "[9]", result: 42 };
    });

    expect(out).toBe(42);
    expect(store.get("fresh")).toBe("[9]");
  });

  it("writes NOTHING when decide returns no window (a denial / nothing-to-refund)", async () => {
    const { db, store, tx } = makeFakeDb({ bucket1: "[1]" });
    currentDb = db;

    const out = await transactPublicScanQuota("bucket1", "test-op", () => ({ result: "denied" }));

    expect(out).toBe("denied");
    expect(tx.publicScanQuota.upsert).not.toHaveBeenCalled();
    expect(store.get("bucket1")).toBe("[1]");
  });

  it("wraps the WHOLE closure in withRetry with the caller's label (retryable unit of work)", async () => {
    currentDb = makeFakeDb().db;

    await transactPublicScanQuota("bucket1", "public-scan-quota-refund", () => ({ result: undefined }));

    expect(mockWithRetry).toHaveBeenCalledTimes(1);
    expect(mockWithRetry.mock.calls[0][1]).toEqual({ label: "public-scan-quota-refund" });
  });
});

describe("transactPublicScanQuota — DSQL vs Postgres isolation selection", () => {
  it("Postgres (no DSQL config) ⇒ Serializable isolation reaches $transaction", async () => {
    mockReadDsqlConfig.mockReturnValue(null);
    currentDb = makeFakeDb().db;

    await transactPublicScanQuota("b", "op", () => ({ result: undefined }));

    expect(capturedTxOptions).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it("DSQL (config present) ⇒ NO explicit isolation — DSQL rejects an isolation level", async () => {
    mockReadDsqlConfig.mockReturnValue({ endpoint: "x.dsql.us-east-1.on.aws", region: "us-east-1" });
    currentDb = makeFakeDb().db;

    await transactPublicScanQuota("b", "op", () => ({ result: undefined }));

    expect(capturedTxOptions).toBeUndefined();
  });
});
