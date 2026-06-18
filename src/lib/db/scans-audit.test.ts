// Audit-log READ path — pins the two cross-tenant / pagination invariants the compliance trail relies on:
//   (A) getAuditLog scopes EVERY query to the resolved org id — a foreign org's id is never put in the
//       auditLog.findMany `where`, so one tenant's audit trail can't leak into another's.
//   (B) keyset pagination uses the decoded cursor verbatim (composite (at,id) tie-break, at-desc/id-desc
//       order) and a forged/undecodable cursor is ignored (page 1, no OR clause) rather than throwing.
// The Prisma client is mocked so we capture the exact args getAuditLog passes — no real DB.

import { describe, it, expect, beforeEach, vi } from "vitest";
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

import { getAuditLog } from "./scans-audit";

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
    expect(at.lte).toEqual(new Date("2026-02-01T00:00:00.000Z")); // inclusive upper bound
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
