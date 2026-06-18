// Tenant-resolution + cache re-verify + orphan-write guard for ensureOrgId. This is the function
// that decides which org every Scan/Repository/AuditLog row is written under. Under
// relationMode="prisma" there are NO foreign keys, so a regression here silently orphans or
// cross-attributes customer data with no DB error to alert on — these tests pin the load-bearing
// invariants: resolve the correct id for a slug, re-verify a cached id past ORG_REVERIFY_MS (drop
// it when the org row is gone), and never default an unresolvable org to some other tenant.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Prisma } from "@prisma/client";

const { mockGetPrisma } = vi.hoisted(() => ({
  mockGetPrisma: vi.fn(),
}));

// withRetry is passed through so the real retry wrapping is transparent to these tests; the
// org-resolution logic it wraps is what we assert. getPrisma is the injection point for the fake.
vi.mock("@/lib/db/client", () => ({
  getPrisma: mockGetPrisma,
  isDbConfigured: () => true,
  withRetry: (fn: () => unknown) => fn(),
}));

import { ensureOrgId, invalidateOrgIdCache, DEFAULT_ORG_SLUG } from "./scans-shared";

/**
 * Fake prisma backed by an in-memory `organization` table keyed by id. findUnique resolves by id
 * (the PK re-verify read) or by slug (the resolve/create read). create assigns a fresh id and
 * inserts. Every call is a spy so we can assert "cache hit ⇒ zero DB calls" and "re-verify ⇒ one
 * findUnique-by-id". `failCreateOnceWithP2002` forces the next create to lose the first-create race
 * (P2002) so we can drive the upsertRacing conflict re-read.
 */
function fakePrisma(seed: Array<{ id: string; slug: string; name?: string }> = []) {
  const rows = new Map<string, { id: string; slug: string; name: string }>();
  for (const r of seed) rows.set(r.id, { id: r.id, slug: r.slug, name: r.name ?? r.slug });
  let nextId = 1;
  const state = { failCreateOnceWithP2002: false };

  const findUnique = vi.fn(
    async ({ where }: { where: { id?: string; slug?: string } }) => {
      if (where.id !== undefined) {
        const row = rows.get(where.id);
        return row ? { id: row.id } : null;
      }
      if (where.slug !== undefined) {
        for (const row of rows.values()) if (row.slug === where.slug) return { id: row.id };
        return null;
      }
      return null;
    },
  );

  const create = vi.fn(
    async ({ data }: { data: { slug: string; name: string } }) => {
      if (state.failCreateOnceWithP2002) {
        state.failCreateOnceWithP2002 = false;
        // Simulate a concurrent winner having just inserted the row, so the conflict re-read finds it.
        if (![...rows.values()].some((r) => r.slug === data.slug)) {
          const winnerId = `org_winner_${nextId++}`;
          rows.set(winnerId, { id: winnerId, slug: data.slug, name: data.name });
        }
        // Use the REAL Prisma error so production isUniqueConstraintError (which uses
        // `instanceof Prisma.PrismaClientKnownRequestError && code==="P2002"`) recognizes it and
        // upsertRacing actually takes its conflict-recovery branch.
        throw new Prisma.PrismaClientKnownRequestError(
          "Unique constraint failed on the fields: (`slug`)",
          { code: "P2002", clientVersion: "test" },
        );
      }
      const id = `org_${nextId++}`;
      rows.set(id, { id, slug: data.slug, name: data.name });
      return { id };
    },
  );

  return {
    prisma: {
      organization: { findUnique, create },
    },
    rows,
    findUnique,
    create,
    state,
  };
}

beforeEach(() => {
  mockGetPrisma.mockReset();
  invalidateOrgIdCache(); // process-local cache survives across tests — clear it every time
});

afterEach(() => {
  invalidateOrgIdCache();
});

describe("ensureOrgId — tenant resolution (correct id per slug)", () => {
  it("resolves an existing org by slug to ITS id and uses no create", async () => {
    const { prisma, create } = fakePrisma([
      { id: "org_acme", slug: "acme" },
      { id: "org_other", slug: "other" },
    ]);
    mockGetPrisma.mockReturnValue(prisma);

    const id = await ensureOrgId("acme");

    // The load-bearing invariant: the id is the one whose slug matches — never the other tenant's.
    expect(id).toBe("org_acme");
    expect(id).not.toBe("org_other");
    expect(create).not.toHaveBeenCalled();
  });

  it("creates the org once when the slug is missing, then caches its id", async () => {
    const { prisma, create, findUnique } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    const id = await ensureOrgId("brand-new");

    expect(id).toBe("org_1");
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { slug: "brand-new", name: "brand-new" } }),
    );
    // findUnique-by-slug (miss) happened before the create.
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: "brand-new" } }),
    );
  });

  it("names the default public org 'Public Scans' on first create", async () => {
    const { prisma, create } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    await ensureOrgId(DEFAULT_ORG_SLUG);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { slug: "public", name: "Public Scans" } }),
    );
  });

  it("keeps two different slugs attributed to two distinct ids (no cross-attribution)", async () => {
    const { prisma } = fakePrisma([
      { id: "org_a", slug: "tenant-a" },
      { id: "org_b", slug: "tenant-b" },
    ]);
    mockGetPrisma.mockReturnValue(prisma);

    const a = await ensureOrgId("tenant-a");
    const b = await ensureOrgId("tenant-b");

    expect(a).toBe("org_a");
    expect(b).toBe("org_b");
    expect(a).not.toBe(b);
  });
});

describe("ensureOrgId — cache hit within the re-verify window", () => {
  it("returns the cached id without ANY DB call on the second resolution", async () => {
    const { prisma, findUnique, create } = fakePrisma([{ id: "org_acme", slug: "acme" }]);
    mockGetPrisma.mockReturnValue(prisma);

    const first = await ensureOrgId("acme");
    const callsAfterFirst = findUnique.mock.calls.length;

    const second = await ensureOrgId("acme");

    expect(second).toBe(first);
    // Within ORG_REVERIFY_MS the cached id is trusted outright — no extra findUnique, no create.
    expect(findUnique.mock.calls.length).toBe(callsAfterFirst);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("ensureOrgId — re-verify past ORG_REVERIFY_MS (orphan-write guard)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("after the window, a PK re-check that STILL FINDS the row reuses the id and refreshes verifiedAt", async () => {
    const { prisma, findUnique } = fakePrisma([{ id: "org_acme", slug: "acme" }]);
    mockGetPrisma.mockReturnValue(prisma);

    const first = await ensureOrgId("acme");
    const callsBefore = findUnique.mock.calls.length;

    // Advance past the 5-minute re-verify window.
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    const second = await ensureOrgId("acme");

    expect(second).toBe(first);
    // Exactly one extra DB read happened: the PK re-check by id.
    expect(findUnique.mock.calls.length).toBe(callsBefore + 1);
    expect(findUnique).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { id: "org_acme" } }),
    );

    // And a THIRD call right after is a cache hit again (verifiedAt refreshed) — no further read.
    const callsAfterReverify = findUnique.mock.calls.length;
    const third = await ensureOrgId("acme");
    expect(third).toBe(first);
    expect(findUnique.mock.calls.length).toBe(callsAfterReverify);
  });

  it("after the window, a PK re-check that finds the org GONE drops the stale id and re-resolves (never returns the dangling id)", async () => {
    const { prisma, rows, create } = fakePrisma([{ id: "org_acme", slug: "acme" }]);
    mockGetPrisma.mockReturnValue(prisma);

    const first = await ensureOrgId("acme");
    expect(first).toBe("org_acme");

    // Org is deleted (retention purge / re-seed) while this instance holds the cached id.
    rows.delete("org_acme");

    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    const second = await ensureOrgId("acme");

    // The orphan-write guard: the stale id is NOT returned for a row that no longer exists. With the
    // slug now absent the function re-creates the org under a fresh id rather than orphaning writes.
    expect(second).not.toBe("org_acme");
    expect(create).toHaveBeenCalledTimes(1);
    expect(rows.has(second)).toBe(true);
  });

  it("after the window with the org REPLACED under a new id, returns the new id (not the stale one)", async () => {
    const { prisma, rows } = fakePrisma([{ id: "org_old", slug: "acme" }]);
    mockGetPrisma.mockReturnValue(prisma);

    const first = await ensureOrgId("acme");
    expect(first).toBe("org_old");

    // Re-seed: same slug, brand-new id (the classic "deleted + recreated" hazard).
    rows.delete("org_old");
    rows.set("org_new", { id: "org_new", slug: "acme", name: "acme" });

    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    const second = await ensureOrgId("acme");

    // Re-verify-by-id misses (org_old gone) → drop cache → re-resolve by slug → the NEW id.
    expect(second).toBe("org_new");
  });
});

describe("invalidateOrgIdCache", () => {
  it("invalidateOrgIdCache(slug) forces a DB re-resolve on the next call for that slug only", async () => {
    const { prisma, findUnique } = fakePrisma([
      { id: "org_acme", slug: "acme" },
      { id: "org_beta", slug: "beta" },
    ]);
    mockGetPrisma.mockReturnValue(prisma);

    await ensureOrgId("acme");
    await ensureOrgId("beta");
    const callsBefore = findUnique.mock.calls.length;

    invalidateOrgIdCache("acme");

    // 'acme' must re-resolve (a slug read); 'beta' is still a pure cache hit (no read).
    const acme = await ensureOrgId("acme");
    const beta = await ensureOrgId("beta");

    expect(acme).toBe("org_acme");
    expect(beta).toBe("org_beta");
    expect(findUnique.mock.calls.length).toBe(callsBefore + 1);
    expect(findUnique).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { slug: "acme" } }),
    );
  });

  it("invalidateOrgIdCache() with no arg clears ALL slugs, forcing every next call to re-resolve", async () => {
    const { prisma, findUnique } = fakePrisma([
      { id: "org_acme", slug: "acme" },
      { id: "org_beta", slug: "beta" },
    ]);
    mockGetPrisma.mockReturnValue(prisma);

    await ensureOrgId("acme");
    await ensureOrgId("beta");
    const callsBefore = findUnique.mock.calls.length;

    invalidateOrgIdCache();

    await ensureOrgId("acme");
    await ensureOrgId("beta");

    // Both re-resolved: two extra slug reads.
    expect(findUnique.mock.calls.length).toBe(callsBefore + 2);
  });
});

describe("ensureOrgId — first-create race (P2002) recovery via upsertRacing", () => {
  it("recovers from a lost create race by re-reading the row the winner created (id never duplicated)", async () => {
    const { prisma, state, rows, create } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    // Force the create to lose the race: the fake inserts a 'winner' row under this slug, then throws
    // a real Prisma P2002, mirroring a concurrent caller having committed first.
    state.failCreateOnceWithP2002 = true;

    const id = await ensureOrgId("raced");

    // upsertRacing caught the P2002 and ran its conflict re-read, returning the winner's row — so the
    // id is the single non-duplicated row that exists under this slug, and no error escaped.
    const matching = [...rows.values()].filter((r) => r.slug === "raced");
    expect(matching).toHaveLength(1);
    expect(id).toBe(matching[0].id);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
