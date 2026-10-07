import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// dbReadStrict / DbUnavailableError — the opt-in strict twin of dbReadSafe (robustness-2, council r2).
//
// dbReadSafe resolves its fallback when the database is configured but UNREACHABLE, which is right
// for its ~74 callers and wrong for the report permalink, where a null report reads as "never
// scanned". dbReadStrict must behave like dbReadSafe in every branch EXCEPT that one: it throws a
// typed DbUnavailableError (driver error kept as `cause`) where dbReadSafe degrades. Each case below
// runs both wrappers against the same failure, so a drift between the twins fails here.
//
// The PrismaClient constructor is mocked (as in client.test.ts) so the auth-expiry branch can really
// reconnect: static DATABASE_URL mode rebuilds a fresh fake client.

type FakeClient = { id: number; $queryRaw: ReturnType<typeof vi.fn>; $disconnect: ReturnType<typeof vi.fn> };
const constructed: FakeClient[] = [];
let seq = 0;

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class {
    constructor(public opts?: { connectionString?: string }) {}
  },
}));
vi.mock("@prisma/client", () => ({
  PrismaClient: class {
    id = ++seq;
    $queryRaw = vi.fn(async () => [{ "?column?": 1 }]);
    $disconnect = vi.fn(async () => {});
    constructor() {
      constructed.push(this as unknown as FakeClient);
    }
  },
}));

import { DbUnavailableError, dbReadSafe, dbReadStrict, getPrisma } from "@/lib/db/client";

const g = globalThis as unknown as { __ascentPrisma?: unknown; __ascentPrismaRefresh?: Promise<unknown> };
let savedUrl: string | undefined;
let savedState: unknown;

beforeEach(() => {
  savedUrl = process.env.DATABASE_URL;
  savedState = g.__ascentPrisma;
  g.__ascentPrisma = undefined;
  g.__ascentPrismaRefresh = undefined;
  constructed.length = 0;
  seq = 0;
  process.env.DATABASE_URL = "postgresql://localhost:5432/app";
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  if (savedUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedUrl;
  g.__ascentPrisma = savedState;
  vi.restoreAllMocks();
});

const UNREACHABLE: [string, () => unknown][] = [
  ["PrismaClientInitializationError", () =>
    Object.assign(new Error("Can't reach database server at `localhost:5432`"), { name: "PrismaClientInitializationError" })],
  ["driver-adapter errno ECONNREFUSED", () =>
    Object.assign(new Error("Invalid `prisma.scan.findFirst()` invocation:"), { code: "ECONNREFUSED" })],
  ["P1001", () => ({ code: "P1001", message: "Can't reach database server" })],
];

describe("dbReadStrict", () => {
  it("returns the read result when it succeeds", async () => {
    expect(await dbReadStrict(async () => "rows")).toBe("rows");
  });

  it.each(UNREACHABLE)("%s: throws a typed DbUnavailableError where dbReadSafe degrades", async (_label, make) => {
    const cause = make();
    // The twin, unchanged: the same failure resolves the fallback.
    await expect(dbReadSafe(async () => { throw cause; }, "fallback")).resolves.toBe("fallback");

    const err = await dbReadStrict(async () => { throw cause; }).then(
      () => { throw new Error("expected dbReadStrict to reject"); },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(DbUnavailableError);
    expect(err).toMatchObject({ name: "DbUnavailableError", code: "DB_UNAVAILABLE" });
    expect((err as Error).cause).toBe(cause);
    expect((err as Error).message).toMatch(/^database unreachable: /);
  });

  it.each([
    ["a constraint error", { code: "P2002", message: "Unique constraint failed" }],
    ["a query timeout", { code: "P1008", message: "Operations timed out" }],
    ["a bad column", new Error('column "x" does not exist')],
  ])("re-throws %s against a live database unchanged — the same as dbReadSafe", async (_label, cause) => {
    await expect(dbReadSafe(async () => { throw cause; }, null)).rejects.toBe(cause);
    await expect(dbReadStrict(async () => { throw cause; })).rejects.toBe(cause);
  });

  it("recovers an auth-expiry: reconnects with a fresh client and retries the read once", async () => {
    getPrisma(); // the cached (stale-token) client
    let calls = 0;
    const result = await dbReadStrict(async () => {
      calls++;
      const c = getPrisma() as unknown as FakeClient;
      if (calls === 1) throw { code: "28P01", message: "token expired" };
      return c.id;
    });
    expect(calls).toBe(2);
    expect(constructed).toHaveLength(2);
    expect(result).toBe(constructed[1]!.id);
  });

  it("an auth-expiry whose retry finds the DB unreachable throws DbUnavailableError (dbReadSafe degrades)", async () => {
    const unreachable = UNREACHABLE[0]![1]();
    const read = (calls: { n: number }) => async () => {
      calls.n++;
      if (calls.n === 1) throw { code: "28P01", message: "token expired" };
      throw unreachable;
    };
    await expect(dbReadSafe(read({ n: 0 }), "fallback")).resolves.toBe("fallback");
    const calls = { n: 0 };
    await expect(dbReadStrict(read(calls))).rejects.toMatchObject({ name: "DbUnavailableError", cause: unreachable });
    expect(calls.n).toBe(2);
  });

  it("an auth-expiry whose retry hits a live query error re-throws that error", async () => {
    const live = new Error("permission denied for table scan");
    let calls = 0;
    await expect(
      dbReadStrict(async () => {
        calls++;
        if (calls === 1) throw { code: "28P01", message: "token expired" };
        throw live;
      }),
    ).rejects.toBe(live);
  });
});
