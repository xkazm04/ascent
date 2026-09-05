// The share-link revocation ledger and the grant inventory built on top of it.
//
// What must hold, and why each of these was a real hazard before:
//   • ONE lookup, two namespaces — the briefing check used to be inlined on the shared page while this
//     module held a live-share-only copy, so a rule added to one (like the fail-closed catch below)
//     silently didn't apply to the other.
//   • FAIL CLOSED — an unreachable ledger must read as "revoked", for the single lookup and for the
//     batched one the list view uses. Fail-open here means a leaked link keeps working during an outage.
//   • The list is reconstructed from AUDIT rows, and a grant whose mint row predates a field (or whose
//     row is legacy) must still list rather than throw.

import { describe, it, expect, vi, beforeEach } from "vitest";

const getSessionVersion = vi.fn<(key: string) => Promise<number>>(async () => 0);
const bumpSessionVersion = vi.fn<(key: string) => Promise<number>>(async () => 1);
vi.mock("@/lib/db/sessions", () => ({
  getSessionVersion: (k: string) => getSessionVersion(k),
  bumpSessionVersion: (k: string) => bumpSessionVersion(k),
}));

const findMany = vi.fn<(args: unknown) => Promise<{ login: string }[]>>(async () => []);
let dbConfigured = true;
vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => dbConfigured,
  getPrisma: () => ({ sessionRevocation: { findMany } }),
}));

const getAuditLog = vi.fn<(org: string, q: { action?: string; limit?: number }) => Promise<unknown>>(async () => null);
vi.mock("@/lib/db/scans-audit", () => ({ getAuditLog: (o: string, q: never) => getAuditLog(o, q) }));

import {
  isBriefingShareRevoked,
  isLiveShareRevoked,
  listBriefingShareGrants,
  revokeBriefingShareLink,
  revokeLiveShareLink,
  revokedBriefingShareJtis,
} from "./org-share";

beforeEach(() => {
  vi.clearAllMocks();
  dbConfigured = true;
  getSessionVersion.mockImplementation(async () => 0);
  findMany.mockImplementation(async () => []);
});

describe("one namespace-aware lookup backs both link kinds", () => {
  it("keys each kind into its own namespace", async () => {
    await isLiveShareRevoked("j1");
    await isBriefingShareRevoked("j1");
    expect(getSessionVersion.mock.calls.map((c) => c[0])).toEqual(["live-share:j1", "briefing-share:j1"]);
  });

  it("revokes into the same namespaces it reads", async () => {
    await revokeLiveShareLink("j2");
    await revokeBriefingShareLink("j2");
    expect(bumpSessionVersion.mock.calls.map((c) => c[0])).toEqual(["live-share:j2", "briefing-share:j2"]);
  });

  it("treats version > 0 as dead and 0 as live, per namespace", async () => {
    getSessionVersion.mockImplementation(async (k: string) => (k === "briefing-share:dead" ? 3 : 0));
    expect(await isBriefingShareRevoked("dead")).toBe(true);
    expect(await isBriefingShareRevoked("alive")).toBe(false);
    // The same jti under the other namespace is a different grant entirely.
    expect(await isLiveShareRevoked("dead")).toBe(false);
  });

  it("ignores an empty jti without touching the ledger", async () => {
    expect(await isBriefingShareRevoked("")).toBe(false);
    await revokeBriefingShareLink("");
    expect(getSessionVersion).not.toHaveBeenCalled();
    expect(bumpSessionVersion).not.toHaveBeenCalled();
  });
});

describe("fail closed", () => {
  it("reports an unreachable ledger as REVOKED, for both kinds", async () => {
    getSessionVersion.mockImplementation(async () => {
      throw new Error("ledger unreachable");
    });
    expect(await isBriefingShareRevoked("j")).toBe(true);
    expect(await isLiveShareRevoked("j")).toBe(true);
  });

  it("reports every jti as revoked when the BATCH lookup fails", async () => {
    findMany.mockImplementation(async () => {
      throw new Error("nope");
    });
    expect([...(await revokedBriefingShareJtis(["a", "b"]))].sort()).toEqual(["a", "b"]);
  });

  it("still distinguishes 'no revocation authority' (no DB) from an outage", async () => {
    // No DB configured: getSessionVersion answers 0 and the link keeps its TTL-only behavior.
    expect(await isBriefingShareRevoked("j")).toBe(false);
    dbConfigured = false;
    expect((await revokedBriefingShareJtis(["a"])).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("matches revocation rows case-insensitively, as the writer lowercases", async () => {
    findMany.mockImplementation(async () => [{ login: "briefing-share:abc-def" }]);
    const dead = await revokedBriefingShareJtis(["ABC-DEF", "other"]);
    expect(dead.has("ABC-DEF")).toBe(true);
    expect(dead.has("other")).toBe(false);
  });
});

type Entry = { id: string; action: string; actorId: string | null; orgId: string | null; at: string; meta: Record<string, unknown>; scan: null; integrity: "ok" };
const entry = (action: string, at: string, meta: Record<string, unknown>, actorId: string | null = "owner-a"): Entry =>
  ({ id: `${action}-${at}`, action, actorId, orgId: "org1", at, meta, scan: null, integrity: "ok" });

function audit(minted: Entry[], opened: Entry[] = []) {
  getAuditLog.mockImplementation(async (_org: string, q: { action?: string }) => ({
    entries: q.action === "briefing.share.opened" ? opened : minted,
    nextCursor: null,
  }));
}

describe("the grant inventory", () => {
  it("reports scope, minter, expiry and opens for each grant", async () => {
    const future = Date.now() + 86_400_000;
    audit(
      [entry("briefing.share.minted", "2026-08-01T10:00:00.000Z", {
        jti: "g1",
        expiresAt: future,
        window: { winStart: "2026-05-01T00:00:00.000Z", winEnd: "2026-08-01T10:00:00.000Z" },
        segment: "acme-client",
        stack: "frontend",
      })],
      [
        entry("briefing.share.opened", "2026-08-03T09:00:00.000Z", { jti: "g1" }, null),
        entry("briefing.share.opened", "2026-08-02T09:00:00.000Z", { jti: "g1" }, null),
      ],
    );
    const [g] = await listBriefingShareGrants("acme");
    expect(g).toMatchObject({
      jti: "g1",
      mintedAt: "2026-08-01T10:00:00.000Z",
      mintedBy: "owner-a",
      segment: "acme-client",
      stack: "frontend",
      revoked: false,
      expired: false,
      opens: 2,
      // Newest-first ordering means the first row seen is the most recent open.
      lastOpenedAt: "2026-08-03T09:00:00.000Z",
    });
    expect(g.window).toEqual({ start: "2026-05-01T00:00:00.000Z", end: "2026-08-01T10:00:00.000Z" });
  });

  it("marks a past-TTL grant expired and a ledger-killed grant revoked", async () => {
    audit([
      entry("briefing.share.minted", "2026-07-01T00:00:00.000Z", { jti: "old", expiresAt: Date.now() - 1000 }),
      entry("briefing.share.minted", "2026-08-01T00:00:00.000Z", { jti: "killed", expiresAt: Date.now() + 1000 }),
    ]);
    findMany.mockImplementation(async () => [{ login: "briefing-share:killed" }]);
    const grants = await listBriefingShareGrants("acme");
    expect(grants.map((g) => [g.jti, g.expired, g.revoked])).toEqual([
      ["old", true, false],
      ["killed", false, true],
    ]);
  });

  it("never calls a grant expired when the mint row recorded no expiry", async () => {
    audit([entry("briefing.share.minted", "2026-08-01T00:00:00.000Z", { jti: "g", window: null })]);
    const [g] = await listBriefingShareGrants("acme");
    expect(g.expiresAt).toBeNull();
    expect(g.expired).toBe(false);
    expect(g.window).toBeNull();
  });

  it("skips pre-jti mint rows rather than listing a grant nobody can revoke", async () => {
    audit([
      entry("briefing.share.minted", "2026-08-01T00:00:00.000Z", { expiresAt: Date.now() + 1000 }),
      entry("briefing.share.minted", "2026-08-02T00:00:00.000Z", { jti: "g" }),
    ]);
    expect((await listBriefingShareGrants("acme")).map((g) => g.jti)).toEqual(["g"]);
  });

  it("returns an empty list without a DB, and when the org has never shared", async () => {
    dbConfigured = false;
    expect(await listBriefingShareGrants("acme")).toEqual([]);
    dbConfigured = true;
    getAuditLog.mockImplementation(async () => ({ entries: [], nextCursor: null }));
    expect(await listBriefingShareGrants("acme")).toEqual([]);
  });

  it("still lists grants when the OPENS read fails", async () => {
    getAuditLog.mockImplementation(async (_o: string, q: { action?: string }) => {
      if (q.action === "briefing.share.opened") throw new Error("boom");
      return { entries: [entry("briefing.share.minted", "2026-08-01T00:00:00.000Z", { jti: "g" })], nextCursor: null };
    });
    const [g] = await listBriefingShareGrants("acme");
    expect([g.jti, g.opens, g.lastOpenedAt]).toEqual(["g", 0, null]);
  });
});
