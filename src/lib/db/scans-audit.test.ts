// Audit-log READ path — pins the two cross-tenant / pagination invariants the compliance trail relies on:
//   (A) getAuditLog scopes EVERY query to the resolved org id — a foreign org's id is never put in the
//       auditLog.findMany `where`, so one tenant's audit trail can't leak into another's.
//   (B) keyset pagination uses the decoded cursor verbatim (composite (at,id) tie-break, at-desc/id-desc
//       order) and a forged/undecodable cursor is ignored (page 1, no OR clause) rather than throwing.
// The Prisma client is mocked so we capture the exact args getAuditLog passes — no real DB.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Prisma } from "@prisma/client";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: mockIsDbConfigured,
  getPrisma: mockGetPrisma,
  withRetry: (fn: () => unknown) => fn(),
}));

import { getAuditLog, claimOrgAuditOnce, releaseAuditClaim } from "./scans-audit";
import { withAuditSignature, verifyAudit } from "./audit-integrity";

/**
 * Fake prisma capturing the audit query. `organization.findUnique` resolves a slug→id map (so
 * resolveOrgId returns the id we control); `auditLog.findMany` records its args and returns the
 * seeded rows; `scan.findMany` returns no enrichment. The captured `findMany` arg is the assertion
 * surface — we read back the `where` (org filter + cursor OR), `orderBy`, and `take`.
 */
function fakePrisma(opts: {
  slugToId: Record<string, string>;
  rows?: Array<{ id: string; action: string; actorId: string | null; at: Date; meta: string }>;
}) {
  const findManyCalls: Array<Record<string, unknown>> = [];
  const rows = opts.rows ?? [];
  return {
    findManyCalls,
    prisma: {
      organization: {
        findUnique: vi.fn(async ({ where }: { where: { slug: string } }) => {
          const id = opts.slugToId[where.slug];
          return id ? { id } : null;
        }),
      },
      auditLog: {
        findMany: vi.fn(async (args: Record<string, unknown>) => {
          findManyCalls.push(args);
          return rows;
        }),
      },
      scan: { findMany: vi.fn(async () => []) },
    },
  };
}

const row = (id: string, atIso: string, meta: Record<string, unknown> = {}) => ({
  id,
  action: "scan.run",
  actorId: "actor_1",
  at: new Date(atIso),
  meta: JSON.stringify(meta),
});

beforeEach(() => {
  mockIsDbConfigured.mockReset();
  mockGetPrisma.mockReset();
  mockIsDbConfigured.mockReturnValue(true);
});

describe("getAuditLog org-scoping (cross-tenant isolation)", () => {
  it("filters auditLog.findMany by the RESOLVED org id, never a foreign org's id", async () => {
    const { prisma, findManyCalls } = fakePrisma({
      slugToId: { acme: "org_acme", evil: "org_evil" },
      rows: [row("a1", "2026-01-02T00:00:00.000Z")],
    });
    mockGetPrisma.mockReturnValue(prisma);

    await getAuditLog("acme");

    expect(findManyCalls).toHaveLength(1);
    const where = findManyCalls[0].where as Prisma.AuditLogWhereInput;
    // The org filter is present and is the acme id — the foreign org's id is never queried.
    expect(where.orgId).toBe("org_acme");
    expect(JSON.stringify(where)).not.toContain("org_evil");
  });

  it("normalizes a mixed-case slug before resolving, so the read agrees with the lower-cased write (audit-log #4)", async () => {
    // Org rows are persisted lower-cased; the WRITE path (recordOrgAudit → getOrgId → getOrgBySlug)
    // already lower-cases, but the READ path did NOT — so a mixed-case slug (`/org/MyOrg`, an API
    // caller's raw casing) missed the canonical row and returned an EMPTY trail even though entries were
    // written under org_my. getAuditLog now normalizes first, so those entries are no longer invisible.
    const { prisma, findManyCalls } = fakePrisma({
      slugToId: { myorg: "org_my" },
      rows: [row("a1", "2026-01-02T00:00:00.000Z")],
    });
    mockGetPrisma.mockReturnValue(prisma);

    const page = await getAuditLog("MyOrg");

    expect(page!.entries.map((e) => e.id)).toEqual(["a1"]); // trail is found, not empty
    const where = findManyCalls[0].where as Prisma.AuditLogWhereInput;
    expect(where.orgId).toBe("org_my");
  });

  it("returns an empty page (and never queries auditLog) when the org slug doesn't resolve", async () => {
    const { prisma } = fakePrisma({ slugToId: {} }); // no org → resolveOrgId returns null
    mockGetPrisma.mockReturnValue(prisma);

    const page = await getAuditLog("ghost-org");

    expect(page).toEqual({ entries: [], nextCursor: null });
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });

  it("returns null without touching prisma when persistence is disabled", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    mockGetPrisma.mockReturnValue(undefined);

    const page = await getAuditLog("acme");

    expect(page).toBeNull();
    expect(mockGetPrisma).not.toHaveBeenCalled();
  });

  it("threads action/actorId/since/until filters into the same org-scoped where", async () => {
    const { prisma, findManyCalls } = fakePrisma({ slugToId: { acme: "org_acme" } });
    mockGetPrisma.mockReturnValue(prisma);

    await getAuditLog("acme", {
      action: "scan.run",
      actorId: "actor_9",
      since: "2026-01-01T00:00:00.000Z",
      until: "2026-02-01T00:00:00.000Z",
    });

    const where = findManyCalls[0].where as Prisma.AuditLogWhereInput;
    expect(where.orgId).toBe("org_acme"); // org scope is never dropped when filters are added
    expect(where.action).toBe("scan.run");
    expect(where.actorId).toBe("actor_9");
    const at = where.at as Prisma.DateTimeFilter;
    expect(at.gte).toEqual(new Date("2026-01-01T00:00:00.000Z")); // inclusive lower bound
    expect(at.lte).toEqual(new Date("2026-02-01T00:00:00.000Z")); // explicit-timestamp upper bound is verbatim
  });

  it("treats a date-only `until` as an INCLUSIVE end-of-day bound (no lost final day in the trail/CSV)", async () => {
    const { prisma, findManyCalls } = fakePrisma({ slugToId: { acme: "org_acme" } });
    mockGetPrisma.mockReturnValue(prisma);

    // The <input type="date"> control yields a bare "YYYY-MM-DD" string for both bounds.
    await getAuditLog("acme", { since: "2026-06-01", until: "2026-06-25" });

    const where = findManyCalls[0].where as Prisma.AuditLogWhereInput;
    const at = where.at as Prisma.DateTimeFilter;
    // since: start-of-day is the correct lower bound (unchanged).
    expect(at.gte).toEqual(new Date("2026-06-01"));
    // until: resolved to the END of June 25 so the whole final day is included — previously this was
    // start-of-day UTC, which excluded every entry recorded after midnight on the asked-for last day.
    expect(at.lte).toEqual(new Date("2026-06-25T23:59:59.999Z"));
  });
});

describe("getAuditLog keyset pagination", () => {
  it("orders newest-first by the composite (at desc, id desc) key", async () => {
    const { prisma, findManyCalls } = fakePrisma({
      slugToId: { acme: "org_acme" },
      rows: [row("a1", "2026-01-02T00:00:00.000Z")],
    });
    mockGetPrisma.mockReturnValue(prisma);

    await getAuditLog("acme", { limit: 10 });

    expect(findManyCalls[0].orderBy).toEqual([{ at: "desc" }, { id: "desc" }]);
    // Fetches one extra row to detect a further page (limit + 1).
    expect(findManyCalls[0].take).toBe(11);
  });

  it("applies the decoded cursor as a composite-key OR (strict-less-than at, id tie-break)", async () => {
    const { prisma, findManyCalls } = fakePrisma({
      slugToId: { acme: "org_acme" },
      rows: [row("a0", "2026-01-01T00:00:00.000Z")],
    });
    mockGetPrisma.mockReturnValue(prisma);

    // Build a cursor the way the module emits it: base64url("<iso>|<id>"). Use a value that, if the
    // tie-break were dropped, the test would catch (it asserts BOTH OR arms exist).
    const at = "2026-01-02T03:04:05.000Z";
    const id = "cursor_id_42";
    const cursor = Buffer.from(`${at}|${id}`).toString("base64url");

    await getAuditLog("acme", { cursor });

    const where = findManyCalls[0].where as Prisma.AuditLogWhereInput;
    expect(where.orgId).toBe("org_acme"); // org scope coexists with the cursor
    expect(where.OR).toEqual([
      { at: { lt: new Date(at) } }, // older `at`
      { at: new Date(at), id: { lt: id } }, // same `at`, smaller id (tie-break) — using the cursor verbatim
    ]);
  });

  it("ignores a forged/undecodable cursor (no OR clause — restarts at page 1, never throws)", async () => {
    const { prisma, findManyCalls } = fakePrisma({
      slugToId: { acme: "org_acme" },
      rows: [row("a1", "2026-01-02T00:00:00.000Z")],
    });
    mockGetPrisma.mockReturnValue(prisma);

    const page = await getAuditLog("acme", { cursor: "@@not-a-valid-cursor@@" });

    expect(page).not.toBeNull();
    const where = findManyCalls[0].where as Prisma.AuditLogWhereInput;
    expect(where.orgId).toBe("org_acme");
    expect(where.OR).toBeUndefined();
  });

  it("emits a nextCursor only when an extra row proves another page exists, encoding the last page row", async () => {
    // limit:1 + a 2nd row → hasMore true → page returns 1 entry and a cursor encoding that last row.
    const { prisma } = fakePrisma({
      slugToId: { acme: "org_acme" },
      rows: [
        row("newest", "2026-01-02T00:00:00.000Z"),
        row("older", "2026-01-01T00:00:00.000Z"),
      ],
    });
    mockGetPrisma.mockReturnValue(prisma);

    const page = await getAuditLog("acme", { limit: 1 });

    expect(page).not.toBeNull();
    expect(page!.entries.map((e) => e.id)).toEqual(["newest"]); // only the page slice, extra row dropped
    expect(page!.nextCursor).not.toBeNull();
    // The cursor round-trips to the last RETURNED row (newest), so the next page continues from there.
    const decoded = Buffer.from(page!.nextCursor as string, "base64url").toString("utf8");
    expect(decoded).toBe("2026-01-02T00:00:00.000Z|newest");
  });

  it("returns nextCursor:null when the result fits in one page (no extra row)", async () => {
    const { prisma } = fakePrisma({
      slugToId: { acme: "org_acme" },
      rows: [row("only", "2026-01-02T00:00:00.000Z")],
    });
    mockGetPrisma.mockReturnValue(prisma);

    const page = await getAuditLog("acme", { limit: 25 });

    expect(page!.nextCursor).toBeNull();
  });
});

// G2-33: getAuditLog attaches a per-row `integrity` verdict computed by verifyAudit (audit-integrity.ts),
// but nothing pinned that the WIRING actually populates it correctly from a stored row — only the verdict
// FUNCTION itself was unit-tested (audit-integrity.test.ts). A regression in this plumbing (wrong field
// mapped, verifyAudit never called, always "unsigned") would silently report every row as unverified in
// the compliance viewer — exactly the failure the signing exists to prevent. Fixtures cover all three
// verdicts a real deployment can see, built the way the real write path builds them (withAuditSignature
// over the row's own action/orgId/actorId/createdAt/meta), not by hand-crafting `_sig`.
describe("getAuditLog integrity verdict wiring (G2-33)", () => {
  const ORG_ID = "org_acme";
  const ACTION = "scan.run";
  const ACTOR_ID = "actor_1";
  const AT_ISO = "2026-01-02T00:00:00.000Z";

  beforeEach(() => {
    process.env.AUDIT_SIGNING_SECRET = "test-secret";
  });
  afterEach(() => {
    delete process.env.AUDIT_SIGNING_SECRET;
  });

  // Mirrors row() but lets us control orgId (the column the write path stamps and verifyAudit checks)
  // and hand a raw meta object through (already JSON.stringify'd by the caller).
  const rowWithMeta = (id: string, actorId: string, meta: Record<string, unknown>) => ({
    id,
    action: ACTION,
    actorId,
    orgId: ORG_ID,
    at: new Date(AT_ISO),
    meta: JSON.stringify(meta),
  });

  it("reports 'ok' for an intact signed row — verifyAudit is actually invoked with the stored shape", async () => {
    const signedMeta = withAuditSignature({
      action: ACTION,
      orgId: ORG_ID,
      actorId: ACTOR_ID,
      createdAt: AT_ISO,
      meta: {},
    });
    const { prisma } = fakePrisma({
      slugToId: { acme: ORG_ID },
      rows: [rowWithMeta("ok1", ACTOR_ID, signedMeta)],
    });
    mockGetPrisma.mockReturnValue(prisma);

    const page = await getAuditLog("acme");

    expect(page!.entries).toHaveLength(1);
    expect(page!.entries[0].integrity).toBe("ok");
  });

  it("reports 'tampered' when a signed row's content is altered at rest (DB-edited actorId, stale _sig)", async () => {
    const signedMeta = withAuditSignature({
      action: ACTION,
      orgId: ORG_ID,
      actorId: ACTOR_ID,
      createdAt: AT_ISO,
      meta: {},
    });
    // Simulate a direct DB edit: the actorId column changed after signing, but the stale _sig stays in meta.
    const { prisma } = fakePrisma({
      slugToId: { acme: ORG_ID },
      rows: [rowWithMeta("tampered1", "mallory", signedMeta)],
    });
    mockGetPrisma.mockReturnValue(prisma);

    const page = await getAuditLog("acme");

    expect(page!.entries).toHaveLength(1);
    expect(page!.entries[0].integrity).toBe("tampered");
  });

  it("reports a legacy row with no _sig as 'unsigned', NOT 'tampered'", async () => {
    const { prisma } = fakePrisma({
      slugToId: { acme: ORG_ID },
      rows: [rowWithMeta("legacy1", ACTOR_ID, { plan: "team" })], // no _sig field at all
    });
    mockGetPrisma.mockReturnValue(prisma);

    const page = await getAuditLog("acme");

    expect(page!.entries).toHaveLength(1);
    expect(page!.entries[0].integrity).toBe("unsigned");
    expect(page!.entries[0].integrity).not.toBe("tampered");
  });

  it("assigns each row its OWN verdict independently within the same page (ok + tampered + unsigned mixed)", async () => {
    const okMeta = withAuditSignature({ action: ACTION, orgId: ORG_ID, actorId: ACTOR_ID, createdAt: AT_ISO, meta: {} });
    const staleSig = withAuditSignature({ action: ACTION, orgId: ORG_ID, actorId: ACTOR_ID, createdAt: AT_ISO, meta: {} });

    const { prisma } = fakePrisma({
      slugToId: { acme: ORG_ID },
      rows: [
        rowWithMeta("row_ok", ACTOR_ID, okMeta),
        rowWithMeta("row_tampered", "mallory", staleSig),
        rowWithMeta("row_unsigned", ACTOR_ID, { note: "pre-signing row" }),
      ],
    });
    mockGetPrisma.mockReturnValue(prisma);

    const page = await getAuditLog("acme");

    const byId = new Map(page!.entries.map((e) => [e.id, e.integrity]));
    expect(byId.get("row_ok")).toBe("ok");
    expect(byId.get("row_tampered")).toBe("tampered");
    expect(byId.get("row_unsigned")).toBe("unsigned");
  });
});

// claimOrgAuditOnce collapses the digest cron's old check-then-act idempotency guard (read getAuditLog,
// dispatch, THEN recordOrgAudit) into ONE conditional insert whose affected-row outcome decides the
// winner — so two overlapping runs can't both send the same weekly digest (fleet-alerts-digests #3).
// getOrgId (real) resolves the slug→id via the mocked prisma's organization.findUnique.
describe("claimOrgAuditOnce / releaseAuditClaim — atomic once-per-window claim (fleet #3)", () => {
  interface StoredRow {
    id: string;
    action: string;
    orgId: string | null;
    actorId: string | null;
    at: Date;
    meta: string;
  }

  /**
   * A STATEFUL fake AuditLog table. The claim/release pair is now a two-row protocol (a claim marker and,
   * on failure, a `claim.released` row that cancels it) rather than an insert and a delete, so a stub
   * returning a fixed `existing` can no longer express the behaviour under test: the claim → release →
   * re-claim sequence only means anything against a store that remembers what was written.
   */
  function claimStore(opts: { orgId: string | null; seed?: StoredRow[] }) {
    const rows: StoredRow[] = [...(opts.seed ?? [])];
    let seq = 0;
    const matches = (r: StoredRow, where: Record<string, unknown>) => {
      if (where.action !== undefined && r.action !== where.action) return false;
      if (where.orgId !== undefined && r.orgId !== where.orgId) return false;
      const at = where.at as { gte?: Date } | undefined;
      if (at?.gte && r.at.getTime() < at.gte.getTime()) return false;
      return true;
    };
    const auditLog = {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => matches(r, where))),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null),
      create: vi.fn(async ({ data }: { data: Omit<StoredRow, "id"> }) => {
        const row: StoredRow = { id: `audit_${++seq}`, ...data };
        rows.push(row);
        return row;
      }),
      // Present so a regression back to the delete-based release is caught by an assertion rather than
      // by a TypeError: the ledger is append-only and NOTHING in this module may call it.
      delete: vi.fn(async () => {
        throw new Error("auditLog.delete must never be called — the audit trail is append-only");
      }),
    };
    const prisma = {
      organization: { findUnique: vi.fn(async () => (opts.orgId ? { id: opts.orgId } : null)) },
      auditLog,
      $transaction: vi.fn(async (fn: (t: { auditLog: typeof auditLog }) => unknown) => fn({ auditLog })),
    };
    return { prisma, auditLog, rows };
  }

  it("CLAIMS the window when no marker exists in-window: inserts and returns claimed:true + id", async () => {
    const { prisma, auditLog } = claimStore({ orgId: "org_1" });
    mockGetPrisma.mockReturnValue(prisma);

    const since = new Date("2026-01-01T00:00:00.000Z");
    const res = await claimOrgAuditOnce("org.digest.sent", "claim-a", since, { weekStart: "x" });

    expect(res).toEqual({ claimed: true, id: "audit_1" });
    // The conditional check is scoped to (action, orgId, at >= since), then the insert runs.
    expect(auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { action: "org.digest.sent", orgId: "org_1", at: { gte: since } } }),
    );
    expect(auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("does NOT claim when a live marker already exists in-window: claimed:false, inserts nothing (loser skips)", async () => {
    const { prisma, auditLog } = claimStore({
      orgId: "org_1",
      seed: [
        {
          id: "already_sent",
          action: "org.digest.sent",
          orgId: "org_1",
          actorId: null,
          at: new Date("2026-01-02T00:00:00.000Z"),
          meta: "{}",
        },
      ],
    });
    mockGetPrisma.mockReturnValue(prisma);

    const res = await claimOrgAuditOnce("org.digest.sent", "claim-b", new Date(0), {});
    expect(res).toEqual({ claimed: false, id: null });
    expect(auditLog.create).not.toHaveBeenCalled();
  });

  it("fails CLOSED (claimed:false) when the org can't be resolved — never sends without a durable claim", async () => {
    const { prisma, auditLog } = claimStore({ orgId: null });
    mockGetPrisma.mockReturnValue(prisma);
    const res = await claimOrgAuditOnce("org.digest.sent", "claim-ghost", new Date(0), {});
    expect(res).toEqual({ claimed: false, id: null });
    expect(auditLog.create).not.toHaveBeenCalled();
  });

  it("releaseAuditClaim is a no-op for a null id, and for an id that resolves to no row", async () => {
    const { prisma, auditLog } = claimStore({ orgId: "org_1" });
    mockGetPrisma.mockReturnValue(prisma);

    await releaseAuditClaim(null);
    expect(mockGetPrisma).not.toHaveBeenCalled();

    await releaseAuditClaim("gone");
    expect(auditLog.create).not.toHaveBeenCalled();
  });

  // Direction 6 — the ledger's delete door is closed. A release used to hard-DELETE the claim row: the
  // only delete on AuditLog outside retention, and one that erased the evidence that a dispatch had been
  // attempted and failed. It now APPENDS a `claim.released` record referencing the claim.
  describe("release appends a correction record instead of deleting (append-only ledger)", () => {
    beforeEach(() => {
      process.env.AUDIT_SIGNING_SECRET = "test-secret";
    });
    afterEach(() => {
      delete process.env.AUDIT_SIGNING_SECRET;
    });

    it("claim → release → re-claim succeeds, and the released claim is STILL READABLE", async () => {
      const { prisma, auditLog, rows } = claimStore({ orgId: "org_1" });
      mockGetPrisma.mockReturnValue(prisma);
      const since = new Date("2026-01-01T00:00:00.000Z");

      const first = await claimOrgAuditOnce("org.digest.sent", "acme", since, { weekStart: "w1" });
      expect(first.claimed).toBe(true);

      // A second claim in the SAME window is refused while the marker is live.
      expect((await claimOrgAuditOnce("org.digest.sent", "acme", since, {})).claimed).toBe(false);

      // The guarded side effect failed → release, then the next run must be able to retry.
      await releaseAuditClaim(first.id);
      const retry = await claimOrgAuditOnce("org.digest.sent", "acme", since, { weekStart: "w1" });
      expect(retry.claimed).toBe(true);
      expect(retry.id).not.toBe(first.id);

      // Nothing was deleted: the original claim row, its release record and the retry all survive.
      expect(auditLog.delete).not.toHaveBeenCalled();
      expect(rows.find((r) => r.id === first.id)).toBeDefined();
      const release = rows.find((r) => r.action === "claim.released");
      expect(release).toBeDefined();
      expect(release!.orgId).toBe("org_1"); // same tenant trail as the claim it cancels
      const releaseMeta = JSON.parse(release!.meta) as Record<string, unknown>;
      expect(releaseMeta.releasedClaimId).toBe(first.id);
      expect(releaseMeta.releasedAction).toBe("org.digest.sent");
    });

    it("a release marker cancels only ITS OWN claim — an unreleased live claim still blocks", async () => {
      const { prisma } = claimStore({ orgId: "org_1" });
      mockGetPrisma.mockReturnValue(prisma);
      const since = new Date("2026-01-01T00:00:00.000Z");

      const a = await claimOrgAuditOnce("org.digest.sent", "acme", since, {});
      await releaseAuditClaim(a.id);
      const b = await claimOrgAuditOnce("org.digest.sent", "acme", since, {}); // live again
      expect(b.claimed).toBe(true);
      // b was NOT released, so the window stays closed.
      expect((await claimOrgAuditOnce("org.digest.sent", "acme", since, {})).claimed).toBe(false);
    });

    it("the release record verifies as `ok` — it is signed like every other audit row", async () => {
      const { prisma, rows } = claimStore({ orgId: "org_1" });
      mockGetPrisma.mockReturnValue(prisma);

      const claim = await claimOrgAuditOnce("org.digest.sent", "acme", new Date(0), {});
      await releaseAuditClaim(claim.id);

      const release = rows.find((r) => r.action === "claim.released")!;
      const meta = JSON.parse(release.meta) as Record<string, unknown>;
      expect(
        verifyAudit({
          action: release.action,
          orgId: release.orgId,
          actorId: release.actorId,
          createdAt: release.at.toISOString(),
          meta,
        }),
      ).toBe("ok");
    });
  });
});
