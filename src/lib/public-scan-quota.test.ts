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
  monthlyQuotaExceeded,
  parseHits,
  hashIp,
  hashKey,
  publicScanMonthlyLimit,
  type QuotaResult,
  refundPublicScanQuota,
  removeHit,
  signedInScanMonthlyLimit,
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

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // rolling 30-day "month" (matches the module)
const NOW = 1_700_000_000_000; // fixed epoch for deterministic windows

describe("decideQuota", () => {
  it("allows the first scan from an empty window and counts it", () => {
    const d = decideQuota([], NOW, 3);
    expect(d.allowed).toBe(true);
    expect(d.remaining).toBe(2);
    expect(d.hits).toEqual([NOW]);
    expect(d.resetAt).toBe(NOW + WINDOW_MS);
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

  it("drops hits older than the 30-day window before deciding", () => {
    const stale = NOW - WINDOW_MS - 1; // just outside the window
    const recent = NOW - 1000;
    const d = decideQuota([stale, stale, recent], NOW, 3);
    expect(d.allowed).toBe(true);
    expect(d.hits).toEqual([recent, NOW]); // stale entries pruned, new hit appended
    expect(d.remaining).toBe(1);
  });

  it("frees a slot once the oldest in-window hit ages out (resetAt when denied)", () => {
    const oldest = NOW - WINDOW_MS + 5000; // ages out in 5s
    const d = decideQuota([oldest, NOW - 2000, NOW - 1000], NOW, 3);
    expect(d.allowed).toBe(false);
    expect(d.resetAt).toBe(oldest + WINDOW_MS);
  });

  it("treats a hit exactly at the cutoff as expired (strict >)", () => {
    const atCutoff = NOW - WINDOW_MS; // not > cutoff → excluded
    const d = decideQuota([atCutoff, atCutoff, atCutoff], NOW, 3);
    expect(d.allowed).toBe(true);
    expect(d.hits).toEqual([NOW]);
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

describe("publicScanMonthlyLimit", () => {
  it("defaults to 5", () => {
    const prev = process.env.PUBLIC_SCAN_MONTHLY_LIMIT;
    delete process.env.PUBLIC_SCAN_MONTHLY_LIMIT;
    expect(publicScanMonthlyLimit()).toBe(5);
    if (prev !== undefined) process.env.PUBLIC_SCAN_MONTHLY_LIMIT = prev;
  });

  it("honors a positive override", () => {
    const prev = process.env.PUBLIC_SCAN_MONTHLY_LIMIT;
    process.env.PUBLIC_SCAN_MONTHLY_LIMIT = "10";
    expect(publicScanMonthlyLimit()).toBe(10);
    if (prev === undefined) delete process.env.PUBLIC_SCAN_MONTHLY_LIMIT;
    else process.env.PUBLIC_SCAN_MONTHLY_LIMIT = prev;
  });
});

// The 429 copy must state the ACTUAL allowance, not a hardcoded "5" — the old literal lied under any
// PUBLIC_SCAN_MONTHLY_LIMIT / *_SIGNED_IN override or the elevated signed-in tier (a user-facing untruth
// on the upgrade prompt). The number is derived from the scope that tripped, matching what consume charged.
describe("monthlyQuotaExceeded — derives the limit from the tripped scope", () => {
  const ENV = ["PUBLIC_SCAN_MONTHLY_LIMIT", "PUBLIC_SCAN_MONTHLY_LIMIT_SIGNED_IN"] as const;
  function withEnv(vals: Partial<Record<(typeof ENV)[number], string>>, fn: () => void | Promise<void>) {
    const prev = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
    for (const k of ENV) {
      if (vals[k] === undefined) delete process.env[k];
      else process.env[k] = vals[k];
    }
    try {
      return fn();
    } finally {
      for (const k of ENV) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k]!;
      }
    }
  }

  const denied = (signedIn: boolean): QuotaResult => ({
    enforced: true,
    allowed: false,
    remaining: 0,
    retryAfterSec: 120,
    resetAt: NOW + 1000,
    signedIn,
    chargedAt: null,
  });

  async function errorOf(result: QuotaResult): Promise<{ body: { error: string; code: string; scope: string }; res: Response }> {
    const res = monthlyQuotaExceeded(result);
    const body = (await res.json()) as { error: string; code: string; scope: string };
    return { body, res };
  }

  it("uses the default 5 (anonymous) and returns a 429 with quota headers", async () => {
    await withEnv({}, async () => {
      const { body, res } = await errorOf(denied(false));
      expect(res.status).toBe(429);
      expect(body.error).toContain("your 5 free scans this month");
      expect(body.code).toBe("monthly_quota");
      expect(body.scope).toBe("anon");
      expect(res.headers.get("x-ascent-quota-scope")).toBe("anon");
      expect(res.headers.get("retry-after")).toBe("120");
    });
  });

  it("reflects a PUBLIC_SCAN_MONTHLY_LIMIT override (10), not the old hardcoded 5", async () => {
    await withEnv({ PUBLIC_SCAN_MONTHLY_LIMIT: "10" }, async () => {
      const { body } = await errorOf(denied(false));
      expect(body.error).toContain("your 10 free scans this month");
      expect(body.error).not.toContain("your 5 ");
    });
  });

  it("reflects the elevated signed-in tier for a signed-in viewer", async () => {
    await withEnv({ PUBLIC_SCAN_MONTHLY_LIMIT_SIGNED_IN: "50" }, async () => {
      const { body } = await errorOf(denied(true));
      expect(body.error).toContain("your 50 free scans this month");
      expect(body.scope).toBe("user");
    });
  });

  it("pluralizes: a limit of 1 reads 'free scan', not 'free scans'", async () => {
    await withEnv({ PUBLIC_SCAN_MONTHLY_LIMIT: "1" }, async () => {
      const { body } = await errorOf(denied(false));
      expect(body.error).toContain("your 1 free scan this month");
      expect(body.error).not.toContain("free scans");
    });
  });
});

describe("signedInScanMonthlyLimit", () => {
  const KEYS = ["PUBLIC_SCAN_MONTHLY_LIMIT_SIGNED_IN", "PUBLIC_SCAN_MONTHLY_LIMIT"] as const;
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

  it("defaults to 5", () => {
    withEnv({}, () => expect(signedInScanMonthlyLimit()).toBe(5));
  });

  it("honors a positive override", () => {
    withEnv({ PUBLIC_SCAN_MONTHLY_LIMIT_SIGNED_IN: "50" }, () =>
      expect(signedInScanMonthlyLimit()).toBe(50),
    );
  });

  it("never drops below the anonymous limit (signing in can't grant less)", () => {
    withEnv({ PUBLIC_SCAN_MONTHLY_LIMIT_SIGNED_IN: "2", PUBLIC_SCAN_MONTHLY_LIMIT: "8" }, () =>
      expect(signedInScanMonthlyLimit()).toBe(8),
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
    process.env.PUBLIC_SCAN_MONTHLY_LIMIT = "3"; // pin the limit for deterministic counting
    capturedTxOptions = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.PUBLIC_SCAN_MONTHLY_LIMIT;
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
    process.env.PUBLIC_SCAN_MONTHLY_LIMIT = "3";
    capturedTxOptions = undefined;
  });

  afterEach(() => {
    delete process.env.PUBLIC_SCAN_MONTHLY_LIMIT;
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
