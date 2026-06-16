import { describe, it, expect } from "vitest";
import {
  decideQuota,
  parseHits,
  hashIp,
  hashKey,
  publicScanWeeklyLimit,
  removeHit,
  removeNewestHit,
  signedInScanWeeklyLimit,
} from "./public-scan-quota";

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
