import { beforeEach, describe, expect, it, vi } from "vitest";

// The opt-in `strict` option on the readers the report permalink and the trends/compare pages compose (robustness-2).
//
// Without it, each reader keeps its documented DB-down degrade (null) — unchanged for every existing
// caller (cache tiers, salvage, org repo-dimension routes, badge/gate). With it, a configured-but-
// UNREACHABLE database throws a typed DbUnavailableError instead, so the permalink can tell an outage
// from "never scanned". An UNCONFIGURED database answers its "persistence off" value either way.
// The client wrappers are the REAL ones (dbReadSafe / dbReadStrict); only isDbConfigured and the
// Prisma client are faked.

const h = vi.hoisted(() => ({ configured: true, prisma: null as unknown }));

vi.mock("@/lib/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/client")>()),
  isDbConfigured: () => h.configured,
  getPrisma: () => h.prisma,
}));

import {
  getLatestRecommendations,
  getRepoPassport,
  getRepositoryHistory,
  getScanComparison,
  getScanReportByCommit,
} from "@/lib/db/scans-read";

const unreachable = () =>
  Object.assign(new Error("Can't reach database server at `db.internal:5432`"), { name: "PrismaClientInitializationError" });

/** Every `model.method()` throws `make()`. */
function prismaThrowing(make: () => unknown) {
  const method = async () => {
    throw make();
  };
  return new Proxy({}, { get: () => new Proxy({}, { get: () => method }) });
}

const READERS: [string, (strict?: boolean) => Promise<unknown>][] = [
  ["getScanReportByCommit", (strict) => getScanReportByCommit("acme", "web", { orgSlug: "acme", strict })],
  ["getRepositoryHistory", (strict) => getRepositoryHistory("acme", "web", { orgSlug: "acme", strict })],
  ["getScanComparison", (strict) => getScanComparison("acme", "web", { orgSlug: "acme", strict })],
  ["getRepoPassport", (strict) => getRepoPassport("acme", "web", { orgSlug: "acme", strict })],
  ["getLatestRecommendations", (strict) => getLatestRecommendations("acme", "web", { orgSlug: "acme", strict })],
];

beforeEach(() => {
  h.configured = true;
  h.prisma = prismaThrowing(unreachable);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("strict readers on a configured-but-unreachable database", () => {
  it.each(READERS)("%s: default degrades to null (unchanged)", async (_name, read) => {
    await expect(read()).resolves.toBeNull();
    await expect(read(false)).resolves.toBeNull();
  });

  it.each(READERS)("%s: strict throws DbUnavailableError with the driver error as cause", async (_name, read) => {
    await expect(read(true)).rejects.toMatchObject({
      name: "DbUnavailableError",
      code: "DB_UNAVAILABLE",
      cause: expect.objectContaining({ name: "PrismaClientInitializationError" }),
    });
  });

  it.each(READERS)("%s: strict still answers null when persistence is UNCONFIGURED (keyless MVP)", async (_name, read) => {
    h.configured = false;
    await expect(read(true)).resolves.toBeNull();
  });

  it.each(READERS)("%s: a live-DB query error propagates unchanged in both modes", async (_name, read) => {
    const live = new Error('relation "Scan" does not exist');
    h.prisma = prismaThrowing(() => live);
    await expect(read()).rejects.toBe(live);
    await expect(read(true)).rejects.toBe(live);
  });
});
