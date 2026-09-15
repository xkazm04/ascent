// MOONSHOT #1 — the ledger's READ side. Prisma is faked at the seam so the RULES are under test:
// as-of resolution keys on occurredAt, coverage states its own N and its largest gap, a day is only
// sealable once it has closed, a re-seal never overwrites, and a purged day reads as `no-rows`
// rather than as a tamper.
//
// The WRITE side (recordObservations/latestObservations/listObservationsSince) is W3-L's and is
// covered by its own tests; nothing here touches it.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/client", () => ({ getPrisma: vi.fn(), isDbConfigured: vi.fn(() => true) }));
vi.mock("@/lib/db/org-rollup", () => ({ getOrgId: vi.fn(async () => "org_1") }));
// Only signAudit is faked (it needs a secret). sha256Hex stays REAL: the seal roots are computed
// with it, and stubbing it would make every root equal and every tamper test vacuously pass.
vi.mock("@/lib/db/audit-integrity", async (orig) => ({
  ...(await orig<typeof import("@/lib/db/audit-integrity")>()),
  signAudit: vi.fn(() => "sig-abc"),
}));

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { dayRoot, rowDigest, type SealableRow } from "@/lib/controls/seal";
import { controlCoverage, controlStateAt, controlsAt, listControlTimeline, sealDay, verifySeals } from "./control-observations";

const mockGetPrisma = vi.mocked(getPrisma);
const mockIsDbConfigured = vi.mocked(isDbConfigured);

type Row = SealableRow & { id: string; repoId: string | null; observedAt: Date; scanId: null; jobId: null; deliveryId: null; createdAt: Date; occurredAt: Date };

function row(over: Partial<Row> & { occurredAt: Date }): Row {
  return {
    id: `o_${over.controlId ?? "c"}_${over.occurredAt.getTime()}`,
    orgId: "org_1",
    repoId: "repo_1",
    repoFullName: "acme/api",
    controlId: "branch-protection",
    state: "pass",
    value: "true",
    prevState: null,
    prevValue: null,
    evidenceJson: "{}",
    source: "probe",
    actorLogin: null,
    transition: false,
    observedAt: over.occurredAt,
    scanId: null,
    jobId: null,
    deliveryId: null,
    createdAt: over.occurredAt,
    ...over,
  } as Row;
}

/** The digest the module will compute for a row — built from the same pure helper the module uses,
 *  so a mismatch here means the module changed its canonical field set, not that the test drifted. */
function digestOf(r: Row): string {
  return rowDigest({
    orgId: r.orgId,
    repoFullName: r.repoFullName,
    controlId: r.controlId,
    state: r.state,
    value: r.value,
    prevState: r.prevState,
    prevValue: r.prevValue,
    source: r.source,
    actorLogin: r.actorLogin,
    transition: r.transition,
    occurredAt: r.occurredAt.toISOString(),
    evidenceJson: r.evidenceJson,
  });
}

function fakePrisma(rows: Row[], seals: { day: string; rowCount: number; root: string; prevRoot: string | null; sealedAt: Date; sig: string | null }[] = []) {
  const created: Record<string, unknown>[] = [];
  const controlObservation = {
    findFirst: vi.fn(async ({ where, orderBy }: { where: { occurredAt?: { lte?: Date }; controlId?: string }; orderBy: { occurredAt: string } }) => {
      const hits = rows
        .filter((r) => (where.controlId ? r.controlId === where.controlId : true))
        .filter((r) => (where.occurredAt?.lte ? r.occurredAt <= where.occurredAt.lte : true))
        .sort((a, b) => (orderBy.occurredAt === "desc" ? b.occurredAt.getTime() - a.occurredAt.getTime() : a.occurredAt.getTime() - b.occurredAt.getTime()));
      return hits[0] ?? null;
    }),
    findMany: vi.fn(async (args: { where?: { occurredAt?: { lte?: Date; gte?: Date; lt?: Date } }; orderBy?: { occurredAt?: string } } = {}) => {
      const w = args.where?.occurredAt ?? {};
      const hits = rows.filter(
        (r) => (w.lte ? r.occurredAt <= w.lte : true) && (w.gte ? r.occurredAt >= w.gte : true) && (w.lt ? r.occurredAt < w.lt : true),
      );
      return hits.sort((a, b) =>
        args.orderBy?.occurredAt === "desc" ? b.occurredAt.getTime() - a.occurredAt.getTime() : a.occurredAt.getTime() - b.occurredAt.getTime(),
      );
    }),
  };
  const controlLedgerSeal = {
    findUnique: vi.fn(async ({ where }: { where: { orgId_day: { day: string } } }) => seals.find((s) => s.day === where.orgId_day.day) ?? null),
    findFirst: vi.fn(async ({ where }: { where: { day?: { lt?: string } } }) => {
      const before = seals.filter((s) => (where.day?.lt ? s.day < where.day.lt : true)).sort((a, b) => b.day.localeCompare(a.day));
      return before[0] ?? null;
    }),
    findMany: vi.fn(async () => [...seals].sort((a, b) => a.day.localeCompare(b.day))),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      created.push(data);
      return { ...data, sealedAt: new Date("2026-08-22T00:00:00.000Z") };
    }),
  };
  return { prisma: { controlObservation, controlLedgerSeal }, created, controlLedgerSeal };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
});

describe("controlStateAt / controlsAt", () => {
  const rows = [
    row({ occurredAt: new Date("2026-08-01T00:00:00.000Z"), state: "pass", value: "true" }),
    row({ occurredAt: new Date("2026-08-10T00:00:00.000Z"), state: "fail", value: "false" }),
  ];

  it("returns the newest observation AT OR BEFORE the instant", async () => {
    const { prisma } = fakePrisma(rows);
    mockGetPrisma.mockReturnValue(prisma as never);
    const at = await controlStateAt("acme", "acme/api", "branch-protection", new Date("2026-08-05T00:00:00.000Z"));
    expect(at?.state).toBe("pass");
    expect(at?.occurredAt).toBe("2026-08-01T00:00:00.000Z");
  });

  it("returns null when the ledger does not cover the instant — never the nearest LATER row", async () => {
    const { prisma } = fakePrisma(rows);
    mockGetPrisma.mockReturnValue(prisma as never);
    expect(await controlStateAt("acme", "acme/api", "branch-protection", new Date("2026-07-01T00:00:00.000Z"))).toBeNull();
  });

  it("rejects an unparseable instant rather than defaulting to now", async () => {
    const { prisma } = fakePrisma(rows);
    mockGetPrisma.mockReturnValue(prisma as never);
    expect(await controlStateAt("acme", "acme/api", "branch-protection", "not-a-date")).toBeNull();
  });

  it("controlsAt takes the newest row PER CONTROL in one query", async () => {
    const { prisma } = fakePrisma([
      ...rows,
      row({ occurredAt: new Date("2026-08-02T00:00:00.000Z"), controlId: "signed-commits", state: "fail", value: "false" }),
    ]);
    mockGetPrisma.mockReturnValue(prisma as never);
    const out = await controlsAt("acme", "acme/api", new Date("2026-08-31T00:00:00.000Z"));
    expect(prisma.controlObservation.findMany).toHaveBeenCalledTimes(1);
    expect(out.map((r) => [r.controlId, r.state])).toEqual([
      ["branch-protection", "fail"],
      ["signed-commits", "fail"],
    ]);
  });

  it("is null-not-empty without a database: an empty timeline would claim nothing happened", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect(await listControlTimeline("acme")).toBeNull();
    expect(await controlCoverage("acme")).toBeNull();
    expect(await verifySeals("acme")).toBeNull();
  });
});

describe("controlCoverage", () => {
  it("states its own N, its sources and its largest gap", async () => {
    const { prisma } = fakePrisma([
      row({ occurredAt: new Date("2026-08-01T00:00:00.000Z"), source: "scan" }),
      row({ occurredAt: new Date("2026-08-02T00:00:00.000Z"), source: "probe" }),
      row({ occurredAt: new Date("2026-08-09T00:00:00.000Z"), source: "probe", state: "fail", value: "false" }),
    ]);
    mockGetPrisma.mockReturnValue(prisma as never);
    const [c] = (await controlCoverage("acme")) ?? [];
    expect(c).toMatchObject({
      repoFullName: "acme/api",
      controlId: "branch-protection",
      observations: 3,
      sources: ["probe", "scan"],
      maxGapDays: 7,
      lastState: "fail",
      firstObservedAt: "2026-08-01T00:00:00.000Z",
      lastObservedAt: "2026-08-09T00:00:00.000Z",
    });
  });

  it("reports a null gap for a single observation — one row cannot describe a gap", async () => {
    const { prisma } = fakePrisma([row({ occurredAt: new Date("2026-08-01T00:00:00.000Z") })]);
    mockGetPrisma.mockReturnValue(prisma as never);
    expect((await controlCoverage("acme"))?.[0]?.maxGapDays).toBeNull();
  });

  it("groups per (repo, control)", async () => {
    const { prisma } = fakePrisma([
      row({ occurredAt: new Date("2026-08-01T00:00:00.000Z") }),
      row({ occurredAt: new Date("2026-08-01T00:00:00.000Z"), controlId: "signed-commits" }),
    ]);
    mockGetPrisma.mockReturnValue(prisma as never);
    expect((await controlCoverage("acme"))?.map((c) => c.controlId)).toEqual(["branch-protection", "signed-commits"]);
  });
});

describe("sealDay", () => {
  const now = Date.parse("2026-08-22T09:00:00.000Z");
  const dayRows = [row({ occurredAt: new Date("2026-08-21T04:00:00.000Z") })];

  it("refuses an OPEN day: a root over a day still taking rows is invalid by the next append", async () => {
    const { prisma, created } = fakePrisma(dayRows);
    mockGetPrisma.mockReturnValue(prisma as never);
    expect(await sealDay("acme", "2026-08-22", now)).toBeNull();
    expect(created).toHaveLength(0);
  });

  it("seals a closed day with the root the pure helper computes", async () => {
    const { prisma, created } = fakePrisma(dayRows);
    mockGetPrisma.mockReturnValue(prisma as never);
    const seal = await sealDay("acme", "2026-08-21", now);
    expect(seal).toMatchObject({ day: "2026-08-21", rowCount: 1, signed: true, prevRoot: null });
    expect(seal?.root).toBe(dayRoot([digestOf(dayRows[0]!)], null));
    expect(created).toHaveLength(1);
  });

  it("a day with NO rows gets no seal — an empty root cannot be told from a deleted day", async () => {
    const { prisma, created } = fakePrisma([]);
    mockGetPrisma.mockReturnValue(prisma as never);
    expect(await sealDay("acme", "2026-08-21", now)).toBeNull();
    expect(created).toHaveLength(0);
  });

  it("re-sealing returns the EXISTING seal and never overwrites it", async () => {
    const existing = { day: "2026-08-21", rowCount: 99, root: "old-root", prevRoot: null, sealedAt: new Date(), sig: "s" };
    const { prisma, created } = fakePrisma(dayRows, [existing]);
    mockGetPrisma.mockReturnValue(prisma as never);
    expect((await sealDay("acme", "2026-08-21", now))?.root).toBe("old-root");
    expect(created).toHaveLength(0);
  });
});

describe("verifySeals", () => {
  const dayRows = [row({ occurredAt: new Date("2026-08-21T04:00:00.000Z") }), row({ occurredAt: new Date("2026-08-21T05:00:00.000Z"), controlId: "signed-commits" })];
  const goodRoot = dayRoot(dayRows.map(digestOf), null);
  const seal = (over: Partial<{ day: string; rowCount: number; root: string; prevRoot: string | null }> = {}) => ({
    day: "2026-08-21",
    rowCount: 2,
    root: goodRoot,
    prevRoot: null,
    sealedAt: new Date("2026-08-22T00:00:00.000Z"),
    sig: "sig-abc",
    ...over,
  });

  it("chainOk on an untouched ledger", async () => {
    const { prisma } = fakePrisma(dayRows, [seal()]);
    mockGetPrisma.mockReturnValue(prisma as never);
    const chain = await verifySeals("acme");
    expect(chain?.chainOk).toBe(true);
    expect(chain?.checks[0]).toMatchObject({ verdict: "ok", rowsNow: 2 });
  });

  // The spec's fail-before case (c).
  it("chainOk is FALSE after a row is deleted from a sealed day", async () => {
    const { prisma } = fakePrisma([dayRows[0]!], [seal()]);
    mockGetPrisma.mockReturnValue(prisma as never);
    const chain = await verifySeals("acme");
    expect(chain?.chainOk).toBe(false);
    expect(chain?.checks[0]?.verdict).toBe("tampered");
    // The seal still states what WAS there, which is the whole point of keeping it.
    expect(chain?.checks[0]?.rowCount).toBe(2);
    expect(chain?.checks[0]?.rowsNow).toBe(1);
  });

  it("a fully PURGED day is `no-rows`, not a tamper — retention must not cry wolf", async () => {
    const { prisma } = fakePrisma([], [seal()]);
    mockGetPrisma.mockReturnValue(prisma as never);
    const chain = await verifySeals("acme");
    expect(chain?.checks[0]?.verdict).toBe("no-rows");
    expect(chain?.chainOk).toBe(true);
  });

  it("a broken day-to-day link clears chainOk", async () => {
    // Day two carries its OWN row, so it reaches the chain check rather than short-circuiting on
    // `no-rows`; its stored prevRoot does not match day one's root.
    const nextDay = row({ occurredAt: new Date("2026-08-22T04:00:00.000Z") });
    const second = seal({
      day: "2026-08-22",
      rowCount: 1,
      root: dayRoot([digestOf(nextDay)], "not-yesterdays-root"),
      prevRoot: "not-yesterdays-root",
    });
    const { prisma } = fakePrisma([...dayRows, nextDay], [seal(), second]);
    mockGetPrisma.mockReturnValue(prisma as never);
    const chain = await verifySeals("acme");
    expect(chain?.chainOk).toBe(false);
    expect(chain?.checks[1]?.verdict).toBe("broken-chain");
  });

  it("reports days that hold rows but carry no seal instead of sealing them", async () => {
    const { prisma, controlLedgerSeal } = fakePrisma(dayRows, []);
    mockGetPrisma.mockReturnValue(prisma as never);
    expect((await verifySeals("acme"))?.unsealedDays).toEqual(["2026-08-21"]);
    expect(controlLedgerSeal.create).not.toHaveBeenCalled();
  });
});
