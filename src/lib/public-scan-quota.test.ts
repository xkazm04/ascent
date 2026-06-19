import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Prisma } from "@prisma/client";

// ── Mocks for the DB-bound consume/refund integration (suites at the bottom) ───────────────────
// The pure window math above needs no mocks. The transactional wrapper does: control the DB-config
// gate, the DSQL-vs-Postgres branch, and replace withDb/withRetry with pass-throughs that invoke
// the callback against a fake in-memory `tx`. recordQuotaEvent + clientIp are stubbed to no-ops.
const { mockIsDbConfigured, mockReadDsqlConfig, mockRecordQuotaEvent } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(() => true),
  mockReadDsqlConfig: vi.fn(() => null as unknown), // null = Postgres (static) by default
  mockRecordQuotaEvent: vi.fn(async () => {}),
}));

vi.mock("@/lib/db", () => ({
  isDbConfigured: mockIsDbConfigured,
  // Pass-throughs: invoke the operation against whatever client/tx the test injects via $transaction.
  withDb: (op: (db: unknown) => unknown) => op(currentDb),
  withRetry: (fn: () => unknown) => fn(),
}));
vi.mock("@/lib/db/client", () => ({ readDsqlConfig: mockReadDsqlConfig }));
vi.mock("@/lib/db/quota-events", () => ({ recordQuotaEvent: mockRecordQuotaEvent }));
vi.mock("@/lib/rate-limit", () => ({ clientIp: () => "203.0.113.99" }));

import {
  consumePublicScanQuota,
  decideQuota,
  parseHits,
  hashIp,
  hashKey,
  publicScanWeeklyLimit,
  refundPublicScanQuota,
  removeHit,
  removeNewestHit,
  signedInScanWeeklyLimit,
} from "./public-scan-quota";

// Captured per-test: the fake `db` withDb hands to the operation, plus the isolation options the
// code threads into $transaction (so the isolation-selection suite can assert the branch fired).
let currentDb: { $transaction: (fn: (tx: unknown) => unknown, opts?: unknown) => unknown };
let capturedTxOptions: unknown;

/**
 * A fake Prisma backed by a single in-memory PublicScanQuota row store (Map<ipHash, hitsJson>).
 * findUnique reads the live row, upsert/update write it back — so a consume that appends a hit and a
 * refund that drops one operate on the SAME mutable window, end-to-end. $transaction records the
 * isolation options the code passed (quotaTxOptions()) and runs the body against this store.
 */
function makeFakeDb(seed: Record<string, number[]> = {}) {
  const store = new Map<string, string>();
  for (const [k, hits] of Object.entries(seed)) store.set(k, JSON.stringify(hits));
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
      update: vi.fn(async ({ where, data }: { where: { ipHash: string }; data: { hits: string } }) => {
        store.set(where.ipHash, data.hits);
      }),
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

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000; // fixed epoch for deterministic windows

describe("decideQuota", () => {
  it("allows the first scan from an empty window and counts it", () => {
    const d = decideQuota([], NOW, 3);
    expect(d.allowed).toBe(true);
    expect(d.remaining).toBe(2);
    expect(d.hits).toEqual([NOW]);
    expect(d.resetAt).toBe(NOW + WEEK_MS);
  });

  it("allows up to the limit, then denies", () => {
    const prior = [NOW - 3000, NOW - 2000, NOW - 1000]; // 3 hits already in-window
    const d = decideQuota(prior, NOW, 3);
    expect(d.allowed).toBe(false);
    expect(d.remaining).toBe(0);
    expect(d.hits).toEqual(prior); // denied → window unchanged (no new hit recorded)
  });

  it("reports zero remaining when the consumed scan exactly fills the window", () => {
    const d = decideQuota([NOW - 2000, NOW - 1000], NOW, 3);
    expect(d.allowed).toBe(true);
    expect(d.remaining).toBe(0); // this was the 3rd; none left
  });

  it("drops hits older than the 7-day window before deciding", () => {
    const stale = NOW - WEEK_MS - 1; // just outside the window
    const recent = NOW - 1000;
    const d = decideQuota([stale, stale, recent], NOW, 3);
    expect(d.allowed).toBe(true);
    expect(d.hits).toEqual([recent, NOW]); // stale entries pruned, new hit appended
    expect(d.remaining).toBe(1);
  });

  it("frees a slot once the oldest in-window hit ages out (resetAt when denied)", () => {
    const oldest = NOW - WEEK_MS + 5000; // ages out in 5s
    const d = decideQuota([oldest, NOW - 2000, NOW - 1000], NOW, 3);
    expect(d.allowed).toBe(false);
    expect(d.resetAt).toBe(oldest + WEEK_MS);
  });

  it("treats a hit exactly at the cutoff as expired (strict >)", () => {
    const atCutoff = NOW - WEEK_MS; // not > cutoff → excluded
    const d = decideQuota([atCutoff, atCutoff, atCutoff], NOW, 3);
    expect(d.allowed).toBe(true);
    expect(d.hits).toEqual([NOW]);
  });
});

// The refund policy (meter on commit, not attempt): a consumed slot whose scan delivered nothing —
// invalid/404 repo, upstream failure, client abort, degrade-to-mock, in-stream cache hit — is given
// back by dropping the NEWEST hit (the one consume just appended).
describe("removeNewestHit", () => {
  it("returns an empty window unchanged", () => {
    expect(removeNewestHit([])).toEqual([]);
  });

  it("undoes a consume exactly: decide-then-refund restores the trimmed window", () => {
    const prior = [NOW - 3000, NOW - 1000];
    const d = decideQuota(prior, NOW, 3);
    expect(d.allowed).toBe(true);
    expect(removeNewestHit(d.hits)).toEqual([NOW - 3000, NOW - 1000]);
  });

  it("removes the newest hit regardless of array order", () => {
    expect(removeNewestHit([NOW, NOW - 2000, NOW - 1000])).toEqual([NOW - 2000, NOW - 1000]);
  });

  it("removes exactly ONE entry when timestamps collide", () => {
    expect(removeNewestHit([NOW, NOW, NOW - 1000])).toEqual([NOW, NOW - 1000]);
  });

  it("a refunded slot is immediately consumable again at the limit", () => {
    const full = decideQuota([NOW - 2000, NOW - 1000], NOW, 3); // 3rd of 3 consumed
    expect(full.remaining).toBe(0);
    const refunded = removeNewestHit(full.hits);
    const retry = decideQuota(refunded, NOW + 1, 3);
    expect(retry.allowed).toBe(true); // the refund freed the slot the failed scan took
  });
});

// Value-keyed refund (the CRITICAL fix): each request refunds the EXACT slot it charged, so two
// concurrent refunds on a shared/coalesced scan can never each peel off a different sibling's slot.
describe("removeHit (value-keyed refund)", () => {
  it("removes exactly the charged timestamp, not the newest", () => {
    const t1 = NOW - 2000;
    const t2 = NOW; // newest
    // A request that charged t1 refunds t1 — NOT the newer t2 a sibling is still relying on.
    expect(removeHit([t1, t2], t1)).toEqual([t2]);
  });

  it("is idempotent when the slot is already gone (double refund / aged out)", () => {
    const hits = [NOW - 1000, NOW];
    expect(removeHit(hits, NOW - 99999)).toEqual(hits); // not present → unchanged
  });

  it("removes only ONE entry when two requests charged the same millisecond", () => {
    // Two consumes at the same instant record [NOW, NOW]; each refunds its own → one removed per call.
    const once = removeHit([NOW, NOW, NOW - 1000], NOW);
    expect(once).toEqual([NOW, NOW - 1000]);
    expect(removeHit(once, NOW)).toEqual([NOW - 1000]);
  });

  it("two sibling refunds remove two slots total — never a third (no over-refund)", () => {
    // The double-refund bug: with removeNewestHit, refund A drops t2 and refund B drops t1 even if both
    // belong to live requests. Value-keyed: A drops its own t_a, B drops its own t_b — and a stray
    // third refund of an already-removed slot is a no-op rather than stealing another.
    const tA = NOW - 1000;
    const tB = NOW;
    let hits = [tA, tB];
    hits = removeHit(hits, tA); // request A refunds its charge
    hits = removeHit(hits, tB); // request B refunds its charge
    expect(hits).toEqual([]);
    expect(removeHit(hits, tA)).toEqual([]); // a duplicate/stray refund can't go negative
  });
});

describe("parseHits", () => {
  it("returns [] for null/empty/garbage", () => {
    expect(parseHits(null)).toEqual([]);
    expect(parseHits(undefined)).toEqual([]);
    expect(parseHits("")).toEqual([]);
    expect(parseHits("not json")).toEqual([]);
    expect(parseHits("{}")).toEqual([]);
  });

  it("keeps only finite numbers", () => {
    expect(parseHits(JSON.stringify([1, 2, "x", null, 3]))).toEqual([1, 2, 3]);
  });
});

describe("hashIp", () => {
  it("is deterministic and never returns the raw IP", () => {
    const ip = "203.0.113.7";
    const h = hashIp(ip);
    expect(h).toMatch(/^[0-9a-f]{64}$/); // hex SHA-256
    expect(h).toBe(hashIp(ip)); // stable
    expect(h).not.toContain(ip);
  });

  it("maps different IPs to different hashes", () => {
    expect(hashIp("203.0.113.7")).not.toBe(hashIp("203.0.113.8"));
  });

  it("namespaces IP and user buckets apart (no collision on the same raw value)", () => {
    const v = "203.0.113.7";
    expect(hashIp(v)).toBe(hashKey(`ip:${v}`));
    expect(hashKey(`ip:${v}`)).not.toBe(hashKey(`u:${v}`));
  });
});

describe("publicScanWeeklyLimit", () => {
  it("defaults to 3", () => {
    const prev = process.env.PUBLIC_SCAN_WEEKLY_LIMIT;
    delete process.env.PUBLIC_SCAN_WEEKLY_LIMIT;
    expect(publicScanWeeklyLimit()).toBe(3);
    if (prev !== undefined) process.env.PUBLIC_SCAN_WEEKLY_LIMIT = prev;
  });

  it("honors a positive override", () => {
    const prev = process.env.PUBLIC_SCAN_WEEKLY_LIMIT;
    process.env.PUBLIC_SCAN_WEEKLY_LIMIT = "10";
    expect(publicScanWeeklyLimit()).toBe(10);
    if (prev === undefined) delete process.env.PUBLIC_SCAN_WEEKLY_LIMIT;
    else process.env.PUBLIC_SCAN_WEEKLY_LIMIT = prev;
  });
});

describe("signedInScanWeeklyLimit", () => {
  const KEYS = ["PUBLIC_SCAN_WEEKLY_LIMIT_SIGNED_IN", "PUBLIC_SCAN_WEEKLY_LIMIT"] as const;
  function withEnv(vals: Partial<Record<(typeof KEYS)[number], string>>, fn: () => void) {
    const prev = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) {
      if (vals[k] === undefined) delete process.env[k];
      else process.env[k] = vals[k];
    }
    try {
      fn();
    } finally {
      for (const k of KEYS) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k]!;
      }
    }
  }

  it("defaults to 20", () => {
    withEnv({}, () => expect(signedInScanWeeklyLimit()).toBe(20));
  });

  it("honors a positive override", () => {
    withEnv({ PUBLIC_SCAN_WEEKLY_LIMIT_SIGNED_IN: "50" }, () =>
      expect(signedInScanWeeklyLimit()).toBe(50),
    );
  });

  it("never drops below the anonymous limit (signing in can't grant less)", () => {
    withEnv({ PUBLIC_SCAN_WEEKLY_LIMIT_SIGNED_IN: "2", PUBLIC_SCAN_WEEKLY_LIMIT: "5" }, () =>
      expect(signedInScanWeeklyLimit()).toBe(5),
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
// HIGH (finding #3): the transactional consume → deny → refund path against an in-memory store.
// The window arithmetic (decideQuota / removeHit) is covered above; what's untested is the DB-bound
// wrapper that reads the row, decides, upserts the appended hit, and on failure refunds the EXACT
// charged slot — the layer that can actually leak money. We exercise it end-to-end against a fake
// `tx` backed by a mutable Map, so consume and refund operate on the same persisted window.
describe("consumePublicScanQuota / refundPublicScanQuota (transactional, in-memory store)", () => {
  const KEY = hashIp("203.0.113.99"); // clientIp() is stubbed to this; consume buckets per-IP
  const req = new Request("https://ascent.test/api/scan");

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers(); // distinct, advancing timestamps so each charged slot is individually identifiable
    vi.setSystemTime(1_700_000_000_000);
    mockIsDbConfigured.mockReturnValue(true);
    mockReadDsqlConfig.mockReturnValue(null); // Postgres
    delete process.env.PUBLIC_SCAN_QUOTA_DISABLED;
    process.env.PUBLIC_SCAN_WEEKLY_LIMIT = "3"; // pin the limit for deterministic counting
    capturedTxOptions = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.PUBLIC_SCAN_WEEKLY_LIMIT;
  });

  it("consume decrements inside the tx, over-quota is DENIED with no decrement, and a refund nets to zero", async () => {
    const { db, store } = makeFakeDb();
    currentDb = db;

    // Consume up to the limit (3). Each allowed consume appends exactly one hit to the persisted window.
    // Advance the clock between calls so the three charged slots get distinct timestamps.
    const r1 = await consumePublicScanQuota(req);
    vi.advanceTimersByTime(1000);
    const r2 = await consumePublicScanQuota(req);
    vi.advanceTimersByTime(1000);
    const r3 = await consumePublicScanQuota(req);
    expect([r1.allowed, r2.allowed, r3.allowed]).toEqual([true, true, true]);
    expect(r1.enforced).toBe(true);
    expect(typeof r1.chargedAt).toBe("number"); // chargedAt is the appended timestamp
    expect(new Set([r1.chargedAt, r2.chargedAt, r3.chargedAt]).size).toBe(3); // three distinct slots
    expect(parseHits(store.get(KEY)).length).toBe(3); // three slots actually persisted

    // The 4th (over-quota) consume is DENIED — and crucially the stored window is UNCHANGED (no
    // check-then-act decrement on the deny path; the read+decide+write is one atomic tx body).
    const before = store.get(KEY);
    const denied = await consumePublicScanQuota(req);
    expect(denied).toMatchObject({ enforced: true, allowed: false, remaining: 0, chargedAt: null });
    expect(store.get(KEY)).toBe(before); // deny did not write
    expect(parseHits(store.get(KEY)).length).toBe(3);
    expect(mockRecordQuotaEvent).toHaveBeenCalledWith("quota_deny", "anon"); // denial observed

    // A downstream failure refunds the EXACT slot the 3rd consume charged — transactional, no leak.
    await refundPublicScanQuota(req, {}, r3.chargedAt);
    const after = parseHits(store.get(KEY));
    expect(after.length).toBe(2); // net: 3 consumed − 1 refunded = 2
    expect(after).not.toContain(r3.chargedAt); // exactly that slot removed, not a sibling's
    expect(after).toEqual(expect.arrayContaining([r1.chargedAt, r2.chargedAt]));
  });

  it("refund removes only its OWN charged slot and is idempotent — a second refund never over-credits", async () => {
    const tA = Date.now() - 5000;
    const tB = Date.now() - 4000;
    const { store } = (() => {
      const made = makeFakeDb({ [KEY]: [tA, tB] }); // two live slots from two distinct requests
      currentDb = made.db;
      return made;
    })();

    // Request A refunds ITS slot (tA) — must not peel B's still-live tB (the double-refund race fix).
    await refundPublicScanQuota(req, {}, tA);
    expect(parseHits(store.get(KEY))).toEqual([tB]);

    // A duplicate/stray refund of the same charge is a no-op: it can't drop B's slot or go negative.
    await refundPublicScanQuota(req, {}, tA);
    expect(parseHits(store.get(KEY))).toEqual([tB]); // still exactly one slot — no over-refund leak
  });

  it("fails OPEN (no tx, allow) when persistence is unconfigured — the free funnel never breaks", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    const txSpy = vi.fn();
    currentDb = { $transaction: txSpy };

    const r = await consumePublicScanQuota(req);
    expect(r).toMatchObject({ enforced: false, allowed: true, chargedAt: null });
    expect(txSpy).not.toHaveBeenCalled(); // early return — the transaction body never runs
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
// HIGH (finding #4): pin the DSQL-vs-Postgres isolation selection that makes the consume race-safe.
// quotaTxOptions() is not exported, so we assert its effect THROUGH the consume path: the options it
// returns are exactly what reaches $transaction. Postgres ⇒ { isolationLevel: Serializable } (so a
// concurrent racer aborts with 40001 → withRetry); DSQL ⇒ undefined (DSQL rejects explicit isolation
// and aborts the loser via native OCC). The branch must never invert.
describe("quota transaction isolation selection (DSQL vs Postgres)", () => {
  const req = new Request("https://ascent.test/api/scan");

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDbConfigured.mockReturnValue(true);
    delete process.env.PUBLIC_SCAN_QUOTA_DISABLED;
    process.env.PUBLIC_SCAN_WEEKLY_LIMIT = "3";
    capturedTxOptions = undefined;
  });

  afterEach(() => {
    delete process.env.PUBLIC_SCAN_WEEKLY_LIMIT;
  });

  it("Postgres (no DSQL config) ⇒ Serializable isolation passed to the consume transaction", async () => {
    mockReadDsqlConfig.mockReturnValue(null);
    currentDb = makeFakeDb().db;
    await consumePublicScanQuota(req);
    expect(capturedTxOptions).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it("DSQL (config present) ⇒ NO explicit isolation (undefined) — DSQL rejects an isolation level", async () => {
    mockReadDsqlConfig.mockReturnValue({ endpoint: "x.dsql.us-east-1.on.aws", region: "us-east-1" });
    currentDb = makeFakeDb().db;
    await consumePublicScanQuota(req);
    expect(capturedTxOptions).toBeUndefined();
  });

  it("the refund transaction uses the SAME isolation branch (Serializable on Postgres)", async () => {
    mockReadDsqlConfig.mockReturnValue(null);
    const t = Date.now() - 1000;
    currentDb = makeFakeDb({ [hashIp("203.0.113.99")]: [t] }).db;
    await refundPublicScanQuota(req, {}, t);
    expect(capturedTxOptions).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it("never inverts: Postgres ⇏ undefined and DSQL ⇏ Serializable across both branches", async () => {
    // Postgres branch must not be undefined.
    mockReadDsqlConfig.mockReturnValue(null);
    currentDb = makeFakeDb().db;
    await consumePublicScanQuota(req);
    expect(capturedTxOptions).not.toBeUndefined();

    // DSQL branch must not carry an explicit isolation level.
    mockReadDsqlConfig.mockReturnValue({ endpoint: "y.dsql.on.aws", region: "eu-west-1" });
    currentDb = makeFakeDb().db;
    await consumePublicScanQuota(req);
    expect(capturedTxOptions).toBeUndefined();
  });
});
