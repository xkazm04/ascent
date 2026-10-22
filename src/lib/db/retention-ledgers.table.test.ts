// @vitest-environment node
//
// PURGE_LEDGERS is the declared table the purge derives from. Two claims are pinned here:
//   1. every descriptor's predicate equals the snapshot of the inline predicate it replaced
//      (retention-ledgers.test.ts pins the same snapshots against what prisma actually receives);
//   2. a ledger appended to the table is previewed and deleted with NO edit to purgeExpiredData.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CUTOFF, NOW, before, createPurgeStore, straddlingSeed } from "./retention-purge.fixture";

const { mockGetPrisma } = vi.hoisted(() => ({ mockGetPrisma: vi.fn() }));
vi.mock("@/lib/db/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/client")>("@/lib/db/client");
  return { ...actual, getPrisma: mockGetPrisma, isDbConfigured: () => true };
});
vi.mock("@/lib/db/scans", () => ({ recordAudit: vi.fn(async () => true) }));
vi.mock("@/lib/public-scan-quota", () => ({ purgeStalePublicScanQuota: vi.fn(async () => 0) }));
// A test-only ledger appended to the real table: a fake model aged on orgId + createdAt.
vi.mock("./retention-ledgers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./retention-ledgers")>();
  const fake = {
    key: "memoryCitationsDeleted",
    horizon: "audit",
    model: "fakeLedger",
    label: "retention.prune-fake-ledger",
    scope: (orgId: string) => ({ orgId }),
    aged: (cutoff: Date) => ({ createdAt: { lt: cutoff } }),
    orderBy: { createdAt: "asc" },
  } as const;
  return { ...actual, PURGE_LEDGERS: [...actual.PURGE_LEDGERS, fake] };
});

import { purgeExpiredData } from "./retention";
import { PURGE_LEDGERS, ledgerWhere } from "./retention-ledgers";
import { recordAudit } from "@/lib/db/scans";

beforeEach(() => {
  process.env.RETENTION_FORCE = "1";
  vi.mocked(recordAudit).mockClear();
});
afterEach(() => {
  delete process.env.RETENTION_FORCE;
});

const real = PURGE_LEDGERS.filter((d) => d.model !== "fakeLedger");
const byKey = (key: string) => real.find((d) => d.key === key)!;

describe("descriptor predicates equal the snapshots of the inline predicates they replaced", () => {
  it("covers exactly the four aged ledgers, all on the audit horizon", () => {
    expect(real.map((d) => [d.key, d.model, d.horizon])).toEqual([
      ["usageEventsDeleted", "usageEvent", "audit"],
      ["conformanceReportsDeleted", "conformanceReport", "audit"],
      ["memoryCitationsDeleted", "orgMemoryCitation", "audit"],
      ["controlObservationsDeleted", "controlObservation", "audit"],
    ]);
  });

  it("orgId scope plus a strict `lt` on each ledger's age column, oldest first", () => {
    const snap = {
      usageEventsDeleted: [{ orgId: "org_1", createdAt: { lt: CUTOFF } }, { createdAt: "asc" }],
      conformanceReportsDeleted: [{ orgId: "org_1", reportedAt: { lt: CUTOFF } }, { reportedAt: "asc" }],
      memoryCitationsDeleted: [{ orgId: "org_1", createdAt: { lt: CUTOFF } }, { createdAt: "asc" }],
      controlObservationsDeleted: [{ orgId: "org_1", observedAt: { lt: CUTOFF } }, { observedAt: "asc" }],
    };
    for (const [key, [where, orderBy]] of Object.entries(snap)) {
      expect([key, ledgerWhere(byKey(key), "org_1", CUTOFF), byKey(key).orderBy]).toEqual([key, where, orderBy]);
    }
  });

  it("findings ride the report predicate and die by reportId; control pairs keep their newest", () => {
    const cr = byKey("conformanceReportsDeleted");
    const parent = ledgerWhere(cr, "org_1", CUTOFF);
    expect(cr.children?.key).toBe("conformanceFindingsDeleted");
    expect(cr.children?.model).toBe("conformanceFinding");
    expect(cr.children?.preview(parent)).toEqual({ report: { orgId: "org_1", reportedAt: { lt: CUTOFF } } });
    expect(cr.children?.byParentIds(["a"])).toEqual({ reportId: { in: ["a"] } });
    expect(byKey("controlObservationsDeleted").keepNewestPerPair).toEqual({
      by: ["repoFullName", "controlId"],
      orderBy: [{ observedAt: "desc" }, { id: "desc" }],
    });
    for (const d of real.filter((x) => x.key !== "controlObservationsDeleted")) expect(d.keepNewestPerPair).toBeUndefined();
  });
});

describe("a ledger appended to the table is derived, not hand-listed", () => {
  const seed = () => {
    const s = straddlingSeed();
    s.orgMemoryCitation = [];
    s.fakeLedger = [
      { id: "fk_old1", orgId: "org_1", createdAt: before(2) },
      { id: "fk_old2", orgId: "org_1", createdAt: before(1) },
      { id: "fk_at", orgId: "org_1", createdAt: CUTOFF },
      { id: "fk_other", orgId: "org_2", createdAt: before(9) },
    ];
    return s;
  };

  it("the dry run counts it and the real run deletes the same rows", async () => {
    const store = createPurgeStore(seed());
    mockGetPrisma.mockReturnValue(store.prisma);
    const preview = (await purgeExpiredData({ dryRun: true, onlyOrgSlug: "acme", now: () => NOW }))!;
    expect(preview.results[0]!.memoryCitationsDeleted).toBe(2);
    expect(store.ids("fakeLedger")).toHaveLength(4);
    const run = (await purgeExpiredData({ onlyOrgSlug: "acme", now: () => NOW }))!;
    expect(run.results[0]!.memoryCitationsDeleted).toBe(2);
    expect(store.ids("fakeLedger")).toEqual(["fk_at", "fk_other"]);
  });
});
