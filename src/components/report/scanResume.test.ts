// The scan RESUME ANCHOR (repo-report-shell-tabs #4). A reload of /report?repo= used to look like a
// cold first load, so the hook peeked a cache that cannot hit (the report was never persisted) and
// started a second full ingest + LLM run — six minutes and a second inference bill for a refresh. The
// anchor is the durable breadcrumb that says "this tab already started THIS scan", and every branch of
// it is pinned here rather than in a DOM test, because the subject match and the expiry are what decide
// whether a rejoin is even attempted.

import { describe, it, expect } from "vitest";
import {
  clearScanAnchor,
  defaultScanAnchorStore,
  readScanAnchor,
  scanAnchorSubject,
  writeScanAnchor,
  type ScanAnchorStore,
} from "./scanResume";
import { scanClientTimeoutMs } from "./scanEstimate";

function memoryStore(): ScanAnchorStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** A storage accessor that throws on every call — Safari private mode, a blocked-cookies profile. */
const throwingStore: ScanAnchorStore = {
  getItem: () => {
    throw new Error("SecurityError: storage is not available");
  },
  setItem: () => {
    throw new Error("SecurityError: storage is not available");
  },
  removeItem: () => {
    throw new Error("SecurityError: storage is not available");
  },
};

const web = { repo: "acme/web", fresh: false };
const TTL = scanClientTimeoutMs();

describe("scanResume — the anchor that lets a reloaded tab rejoin its own scan", () => {
  it("reads back live inside the TTL for the subject it was written for", () => {
    const store = memoryStore();
    const subject = scanAnchorSubject(web);
    writeScanAnchor(store, subject, 1_000);

    const live = readScanAnchor(store, subject, { now: 1_000 + TTL - 1, ttlMs: TTL });
    expect(live).toEqual({ startedAt: 1_000 });
  });

  it("does NOT match a different scan subject (a ref turns it into another scan)", () => {
    const store = memoryStore();
    writeScanAnchor(store, scanAnchorSubject(web), 1_000);

    // Same repo, different subject: scoring `feat` is not the scan that was started.
    const scoped = scanAnchorSubject({ ...web, ref: "feat" });
    expect(readScanAnchor(store, scoped, { now: 1_100, ttlMs: TTL })).toBeNull();
    // ...and neither is a sub-path scan, or a fresh re-score.
    expect(readScanAnchor(store, scanAnchorSubject({ ...web, subPath: "apps/api" }), { now: 1_100, ttlMs: TTL })).toBeNull();
    expect(readScanAnchor(store, scanAnchorSubject({ ...web, fresh: true }), { now: 1_100, ttlMs: TTL })).toBeNull();
    // The subject it WAS written for still matches — the miss is about the subject, not a bad write.
    expect(readScanAnchor(store, scanAnchorSubject(web), { now: 1_100, ttlMs: TTL })).toEqual({ startedAt: 1_000 });
  });

  it("reads as expired once it is older than the client scan timeout", () => {
    const store = memoryStore();
    const subject = scanAnchorSubject(web);
    writeScanAnchor(store, subject, 1_000);

    expect(readScanAnchor(store, subject, { now: 1_000 + TTL + 1, ttlMs: TTL })).toBeNull();
    // An expired anchor is also swept, so it can't be read again by a later visit.
    expect(store.map.size).toBe(0);
  });

  it("degrades to NO anchor when the storage accessor throws, and never throws itself", () => {
    const subject = scanAnchorSubject(web);
    expect(() => writeScanAnchor(throwingStore, subject, 1_000)).not.toThrow();
    expect(readScanAnchor(throwingStore, subject, { now: 1_100, ttlMs: TTL })).toBeNull();
    expect(() => clearScanAnchor(throwingStore)).not.toThrow();
  });

  it("treats a garbled or foreign anchor value as no anchor", () => {
    const store = memoryStore();
    writeScanAnchor(store, scanAnchorSubject(web), 1_000);
    const key = [...store.map.keys()][0];
    for (const junk of ["", "{", "null", "[]", '{"subject":"acme/web|false||"}', '{"startedAt":"soon"}']) {
      store.map.set(key, junk);
      expect(readScanAnchor(store, scanAnchorSubject(web), { now: 1_100, ttlMs: TTL })).toBeNull();
    }
  });

  it("clear removes the anchor so the next visit cannot claim a rejoin", () => {
    const store = memoryStore();
    const subject = scanAnchorSubject(web);
    writeScanAnchor(store, subject, 1_000);
    clearScanAnchor(store);
    expect(readScanAnchor(store, subject, { now: 1_100, ttlMs: TTL })).toBeNull();
  });

  it("a later write replaces the previous subject (one scan in flight per tab)", () => {
    const store = memoryStore();
    writeScanAnchor(store, scanAnchorSubject(web), 1_000);
    writeScanAnchor(store, scanAnchorSubject({ repo: "acme/api", fresh: false }), 2_000);
    expect(readScanAnchor(store, scanAnchorSubject(web), { now: 2_100, ttlMs: TTL })).toBeNull();
    expect(readScanAnchor(store, scanAnchorSubject({ repo: "acme/api", fresh: false }), { now: 2_100, ttlMs: TTL })).toEqual({
      startedAt: 2_000,
    });
  });

  it("collapses repo casing the way the scan pipeline does, so a case-only URL change still rejoins", () => {
    expect(scanAnchorSubject({ repo: "Acme/Web", fresh: false })).toBe(scanAnchorSubject(web));
  });

  it("resolves no store at all, rather than throwing, where there is no sessionStorage", () => {
    // This suite runs in the node environment: `sessionStorage` is simply absent, which is the same
    // shape as a server render. The resolver must answer null there instead of throwing on access.
    expect(defaultScanAnchorStore()).toBeNull();
  });
});

// One slot per tab, so a settle must not evict ANOTHER subject's live anchor: without the subject
// guard, a peek hit on a second repo would silently disarm the rejoin of the run still going.
describe("scanResume — a subject-scoped clear", () => {
  it("leaves an anchor belonging to a different subject alone", () => {
    const store = memoryStore();
    const running = scanAnchorSubject(web);
    writeScanAnchor(store, running, 1_000);

    clearScanAnchor(store, scanAnchorSubject({ repo: "acme/api", fresh: false }));

    expect(readScanAnchor(store, running, { now: 1_100, ttlMs: TTL })).toEqual({ startedAt: 1_000 });
    clearScanAnchor(store, running);
    expect(readScanAnchor(store, running, { now: 1_100, ttlMs: TTL })).toBeNull();
  });

  it("sweeps an unreadable slot rather than leaving it to mislead a later read", () => {
    const store = memoryStore();
    writeScanAnchor(store, scanAnchorSubject(web), 1_000);
    const key = [...store.map.keys()][0];
    store.map.set(key, "{not json");
    clearScanAnchor(store, scanAnchorSubject(web));
    expect(store.map.size).toBe(0);
  });
});
