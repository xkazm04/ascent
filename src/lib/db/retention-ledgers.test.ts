// @vitest-environment node
//
// PREDICATE SNAPSHOT PINS for the purge path's aged ledgers (UsageEvent, ConformanceReport and its
// findings, OrgMemoryCitation, ControlObservation, AuditLog). Written against the inline predicates
// purgeExpiredData carried before the ledgers moved into a declared table, so they were green on
// that code by design: they are the proof that the refactor deletes nothing more. Each ledger is
// pinned twice - the literal `where`/`orderBy` handed to prisma, and the rows that survive a store
// that really evaluates it (a row exactly AT the cutoff is kept: the cutoff is a strict `lt`; the
// newest row of every control pair is kept even when it is itself past the cutoff).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CUTOFF, NOW, createPurgeStore, straddlingSeed } from "./retention-purge.fixture";

const { mockGetPrisma } = vi.hoisted(() => ({ mockGetPrisma: vi.fn() }));
vi.mock("@/lib/db/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/client")>("@/lib/db/client");
  return { ...actual, getPrisma: mockGetPrisma, isDbConfigured: () => true };
});
vi.mock("@/lib/db/scans", () => ({ recordAudit: vi.fn(async () => true) }));
vi.mock("@/lib/public-scan-quota", () => ({ purgeStalePublicScanQuota: vi.fn(async () => 0) }));

import { purgeExpiredData } from "./retention";
import { recordAudit } from "@/lib/db/scans";

let store: ReturnType<typeof createPurgeStore>;
beforeEach(() => {
  process.env.RETENTION_FORCE = "1";
  store = createPurgeStore(straddlingSeed());
  mockGetPrisma.mockReturnValue(store.prisma);
  vi.mocked(recordAudit).mockClear();
});
afterEach(() => {
  delete process.env.RETENTION_FORCE;
});

const run = (dryRun: boolean) => purgeExpiredData({ dryRun, onlyOrgSlug: "acme", now: () => NOW });
const firstArgs = (table: string, op: string) => store.callsTo(table, op)[0]?.args;

describe("aged-ledger predicate snapshots (the inline predicates the purge shipped with)", () => {
  it("UsageEvent and OrgMemoryCitation: orgId + strict createdAt lt, oldest first", async () => {
    await run(false);
    for (const t of ["usageEvent", "orgMemoryCitation"]) {
      expect(firstArgs(t, "findMany")).toEqual({
        where: { orgId: "org_1", createdAt: { lt: CUTOFF } },
        orderBy: { createdAt: "asc" },
        take: 500,
        select: { id: true },
      });
    }
    expect(store.ids("usageEvent")).toEqual(["ue_at", "ue_new", "ue_other"]);
    expect(store.ids("orgMemoryCitation")).toEqual(["mc_at", "mc_new"]);
  });

  it("ConformanceReport: reportedAt lt; findings by reportId BEFORE their report, in one transaction", async () => {
    await run(false);
    expect(firstArgs("conformanceReport", "findMany")).toEqual({
      where: { orgId: "org_1", reportedAt: { lt: CUTOFF } },
      orderBy: { reportedAt: "asc" },
      take: 500,
      select: { id: true },
    });
    const order = store.calls.filter((c) => c.op === "deleteMany").map((c) => c.table);
    expect(order.indexOf("conformanceFinding")).toBeLessThan(order.indexOf("conformanceReport"));
    expect(firstArgs("conformanceFinding", "deleteMany")).toEqual({ where: { reportId: { in: ["cr_old"] } } });
    expect(firstArgs("conformanceReport", "deleteMany")).toEqual({ where: { id: { in: ["cr_old"] } } });
    expect(store.ids("conformanceReport")).toEqual(["cr_at"]);
    expect(store.ids("conformanceFinding")).toEqual(["cf_3"]);
  });

  it("ControlObservation: one sweep per pair, the pair's newest excluded in the predicate", async () => {
    await run(false);
    expect(firstArgs("controlObservation", "groupBy")).toEqual({
      by: ["repoFullName", "controlId"],
      where: { orgId: "org_1" },
    });
    expect(firstArgs("controlObservation", "findFirst")).toEqual({
      where: { orgId: "org_1", repoFullName: "acme/api", controlId: "bp" },
      orderBy: [{ observedAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    expect(firstArgs("controlObservation", "findMany")).toEqual({
      where: {
        orgId: "org_1",
        repoFullName: "acme/api",
        controlId: "bp",
        observedAt: { lt: CUTOFF },
        id: { not: "co_a2" },
      },
      orderBy: { observedAt: "asc" },
      take: 500,
      select: { id: true },
    });
    expect(store.ids("controlObservation")).toEqual(["co_a2", "co_b2"]);
  });

  it("AuditLog: orgId + strict at lt, oldest first", async () => {
    await run(false);
    expect(firstArgs("auditLog", "findMany")).toEqual({
      where: { orgId: "org_1", at: { lt: CUTOFF } },
      orderBy: { at: "asc" },
      take: 500,
      select: { id: true },
    });
    expect(store.ids("auditLog")).toEqual(["al_at"]);
  });

  it("the dry run counts over the same predicates (findings ride the report predicate)", async () => {
    await run(true);
    expect(firstArgs("usageEvent", "count")).toEqual({ where: { orgId: "org_1", createdAt: { lt: CUTOFF } } });
    expect(firstArgs("orgMemoryCitation", "count")).toEqual({ where: { orgId: "org_1", createdAt: { lt: CUTOFF } } });
    expect(firstArgs("conformanceReport", "count")).toEqual({ where: { orgId: "org_1", reportedAt: { lt: CUTOFF } } });
    expect(firstArgs("conformanceFinding", "count")).toEqual({
      where: { report: { orgId: "org_1", reportedAt: { lt: CUTOFF } } },
    });
    expect(firstArgs("auditLog", "count")).toEqual({ where: { orgId: "org_1", at: { lt: CUTOFF } } });
    expect(firstArgs("controlObservation", "count")).toEqual({
      where: { orgId: "org_1", repoFullName: "acme/api", controlId: "bp", observedAt: { lt: CUTOFF }, id: { not: "co_a2" } },
    });
  });
});

const AGED_KEYS = [
  "auditDeleted",
  "usageEventsDeleted",
  "conformanceReportsDeleted",
  "conformanceFindingsDeleted",
  "memoryCitationsDeleted",
  "controlObservationsDeleted",
] as const;

describe("preview is a mode of the deleter (guards)", () => {
  it("dry-run counters equal the following real run's counters, key by key", async () => {
    const preview = (await run(true))!.results[0]!;
    const real = (await run(false))!.results[0]!;
    for (const k of AGED_KEYS) expect([k, preview[k]]).toEqual([k, real[k]]);
    expect(real).toMatchObject({
      auditDeleted: 1,
      usageEventsDeleted: 1,
      conformanceReportsDeleted: 1,
      conformanceFindingsDeleted: 2,
      memoryCitationsDeleted: 1,
      controlObservationsDeleted: 2,
    });
  });

  it("a dry run writes no audit row and calls no deleteMany on any ledger", async () => {
    await run(true);
    expect(store.calls.filter((c) => c.op === "deleteMany")).toEqual([]);
    expect(store.calls.filter((c) => c.op === "transaction")).toEqual([]);
    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
  });
});
