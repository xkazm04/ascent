// Saved Roadmap Sandbox scenarios. Three things here are load-bearing and none is visible in the UI
// until it is already wrong:
//   1. `projectedDelta` is DERIVED from the two stored scores, never taken from the client — it is the
//      number reconciliation compares against, so it must agree with its neighbours by construction.
//      (The whole point of this model is that the projection stopped being a rounded number inside an
//      English note that nothing could ever read back.)
//   2. `actual` appears ONLY once a scan NEWER than the modeled one exists, and its delta is measured
//      over the SCENARIO'S baseline — not over "current". Compare against the wrong baseline and
//      projected-vs-actual is two numbers that were never on the same scale.
//   3. The JSON columns degrade to empty on garbage instead of throwing a report tab off the page.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: mockIsDbConfigured,
  getPrisma: mockGetPrisma,
  // dbReadSafe wraps reads in the layer's degrade-to-fallback contract; run it straight through so a
  // thrown error surfaces here instead of being silently swallowed by the harness.
  dbReadSafe: async <T>(fn: () => Promise<T>, fallback: T) => {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  },
}));
vi.mock("@/lib/db/scans-shared", async (orig) => ({
  ...(await orig<typeof import("@/lib/db/scans-shared")>()),
  resolveOrgId: vi.fn(async (slug: string) => (slug === "nope" ? null : "org_1")),
}));

import { getSandboxScenario, saveSandboxScenario, deleteSandboxScenario } from "./sandbox-scenario";

const MODELED_AT = new Date("2026-06-01T00:00:00Z");

type StoredRow = Partial<{
  repoFullName: string;
  authorLogin: string;
  overridesJson: string;
  itemKeysJson: string;
  baselineScore: number;
  baselineLevel: string;
  baselineScanAt: Date;
  projectedScore: number;
  projectedLevel: string;
  projectedDelta: number;
  updatedAt: Date;
}>;

function row(over: StoredRow = {}) {
  return {
    repoFullName: "acme/web",
    authorLogin: "alice",
    overridesJson: JSON.stringify({ D2: 90 }),
    itemKeysJson: JSON.stringify(["acme/web::rec:D2:deadbeef"]),
    baselineScore: 54,
    baselineLevel: "L3",
    baselineScanAt: MODELED_AT,
    projectedScore: 66,
    projectedLevel: "L4",
    projectedDelta: 12,
    updatedAt: new Date("2026-06-02T00:00:00Z"),
    ...over,
  };
}

/** Fake prisma: one scenario row, one repo, and an optional "next scan" newer than the modeled one. */
function fakePrisma(opts: {
  scenario?: ReturnType<typeof row> | null;
  repo?: { id: string } | null;
  nextScan?: { overallScore: number; level: string; scannedAt: Date } | null;
}) {
  const calls = { upsert: [] as Record<string, unknown>[], scanFindFirst: [] as Record<string, unknown>[] };
  return {
    calls,
    client: {
      sandboxScenario: {
        findUnique: vi.fn(async () => opts.scenario ?? null),
        upsert: vi.fn(async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
          calls.upsert.push(args.create);
          return row(args.create as StoredRow);
        }),
        deleteMany: vi.fn(async () => ({ count: 1 })),
      },
      repository: { findUnique: vi.fn(async () => (opts.repo === undefined ? { id: "repo_1" } : opts.repo)) },
      scan: {
        findFirst: vi.fn(async (args: Record<string, unknown>) => {
          calls.scanFindFirst.push(args);
          return opts.nextScan ?? null;
        }),
      },
    },
  };
}

beforeEach(() => {
  mockIsDbConfigured.mockReset();
  mockGetPrisma.mockReset();
  mockIsDbConfigured.mockReturnValue(true);
});

describe("getSandboxScenario", () => {
  it("returns null when persistence is off, and never touches prisma", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect(await getSandboxScenario("acme", "acme", "web", "alice")).toBeNull();
    expect(mockGetPrisma).not.toHaveBeenCalled();
  });

  it("returns null for an unknown org", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma({}).client);
    expect(await getSandboxScenario("nope", "acme", "web", "alice")).toBeNull();
  });

  it("returns null when this author has saved nothing for the repo", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma({ scenario: null }).client);
    expect(await getSandboxScenario("acme", "acme", "web", "alice")).toBeNull();
  });

  it("reads the model back whole — overrides, item keys, and the delta as a NUMBER", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma({ scenario: row() }).client);
    const s = (await getSandboxScenario("acme", "acme", "web", "alice"))!;

    expect(s.overrides).toEqual({ D2: 90 });
    expect(s.itemKeys).toEqual(["acme/web::rec:D2:deadbeef"]);
    expect(s.projected).toEqual({ score: 66, level: "L4", delta: 12 });
    expect(typeof s.projected.delta).toBe("number"); // not parsed out of prose
    expect(s.baseline).toEqual({ score: 54, level: "L3", scannedAt: MODELED_AT.toISOString() });
  });

  it("has NO actual while the modeled scan is still the latest — 'actual +0' would be a lie", async () => {
    const fake = fakePrisma({ scenario: row(), nextScan: null });
    mockGetPrisma.mockReturnValue(fake.client);
    const s = (await getSandboxScenario("acme", "acme", "web", "alice"))!;

    expect(s.actual).toBeNull();
    // The query only ever considers scans STRICTLY after the modeled one.
    expect((fake.calls.scanFindFirst[0]!.where as { scannedAt: { gt: Date } }).scannedAt.gt).toEqual(MODELED_AT);
  });

  it("reports projected-vs-actual over the SCENARIO's baseline once a newer scan lands", async () => {
    const fake = fakePrisma({
      scenario: row(),
      nextScan: { overallScore: 61, level: "L3", scannedAt: new Date("2026-07-01T00:00:00Z") },
    });
    mockGetPrisma.mockReturnValue(fake.client);
    const s = (await getSandboxScenario("acme", "acme", "web", "alice"))!;

    // Projected +12 (54 → 66); actual +7 (54 → 61) measured over the SAME baseline, so the two are
    // directly comparable. Measured over "current" instead, the actual would read as 0.
    expect(s.projected.delta).toBe(12);
    expect(s.actual).toEqual({
      score: 61,
      level: "L3",
      scannedAt: "2026-07-01T00:00:00.000Z",
      delta: 7,
    });
  });

  it("degrades a corrupt JSON column to empty rather than throwing the report tab off the page", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma({ scenario: row({ overridesJson: "{not json", itemKeysJson: "[[[" }) }).client,
    );
    const s = (await getSandboxScenario("acme", "acme", "web", "alice"))!;
    expect(s.overrides).toEqual({});
    expect(s.itemKeys).toEqual([]);
  });

  it("drops non-numeric override values and non-string item keys", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma({
        scenario: row({
          overridesJson: JSON.stringify({ D1: 40, D2: "eighty", D3: null }),
          itemKeysJson: JSON.stringify(["k1", 7, null, "k2"]),
        }),
      }).client,
    );
    const s = (await getSandboxScenario("acme", "acme", "web", "alice"))!;
    expect(s.overrides).toEqual({ D1: 40 });
    expect(s.itemKeys).toEqual(["k1", "k2"]);
  });

  it("still returns the model when the reconciliation read fails — the plan matters more", async () => {
    const fake = fakePrisma({ scenario: row() });
    fake.client.scan.findFirst = vi.fn(async () => {
      throw new Error("db blip");
    });
    mockGetPrisma.mockReturnValue(fake.client);
    const s = (await getSandboxScenario("acme", "acme", "web", "alice"))!;
    expect(s.projected.delta).toBe(12);
    expect(s.actual).toBeNull();
  });
});

describe("saveSandboxScenario", () => {
  it("DERIVES projectedDelta from the stored scores instead of trusting a client number", async () => {
    const fake = fakePrisma({ scenario: null });
    mockGetPrisma.mockReturnValue(fake.client);
    await saveSandboxScenario("acme", "acme", "web", "alice", {
      overrides: { D2: 90 },
      itemKeys: ["k1"],
      baselineScore: 54,
      baselineLevel: "L3",
      baselineScanAt: MODELED_AT.toISOString(),
      projectedScore: 66,
      projectedLevel: "L4",
    });
    expect(fake.calls.upsert[0]!.projectedDelta).toBe(12);
  });

  it("stores an anonymous session under \"\" so the unique key still identifies one row", async () => {
    const fake = fakePrisma({ scenario: null });
    mockGetPrisma.mockReturnValue(fake.client);
    await saveSandboxScenario("acme", "acme", "web", null, {
      overrides: {},
      itemKeys: [],
      baselineScore: 50,
      baselineLevel: "L3",
      baselineScanAt: MODELED_AT.toISOString(),
      projectedScore: 50,
      projectedLevel: "L3",
    });
    // NULL is distinct from NULL in a Postgres unique index — an anonymous scenario keyed on null
    // would accumulate a new row per save instead of replacing.
    expect(fake.calls.upsert[0]!.authorLogin).toBe("");
  });

  it("caps the selected items so the row can't be used as free-text storage", async () => {
    const fake = fakePrisma({ scenario: null });
    mockGetPrisma.mockReturnValue(fake.client);
    await saveSandboxScenario("acme", "acme", "web", "alice", {
      overrides: {},
      itemKeys: Array.from({ length: 500 }, (_, i) => `k${i}`),
      baselineScore: 50,
      baselineLevel: "L3",
      baselineScanAt: MODELED_AT.toISOString(),
      projectedScore: 50,
      projectedLevel: "L3",
    });
    expect(JSON.parse(fake.calls.upsert[0]!.itemKeysJson as string)).toHaveLength(64);
  });

  it("refuses an unparseable baseline timestamp rather than storing an Invalid Date", async () => {
    const fake = fakePrisma({ scenario: null });
    mockGetPrisma.mockReturnValue(fake.client);
    const saved = await saveSandboxScenario("acme", "acme", "web", "alice", {
      overrides: {},
      itemKeys: [],
      baselineScore: 50,
      baselineLevel: "L3",
      baselineScanAt: "not a date",
      projectedScore: 60,
      projectedLevel: "L3",
    });
    expect(saved).toBeNull();
    expect(fake.calls.upsert).toHaveLength(0);
  });
});

describe("deleteSandboxScenario", () => {
  it("is idempotent — discarding nothing is still a success", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma({ scenario: null }).client);
    expect(await deleteSandboxScenario("acme", "acme", "web", "alice")).toBe(true);
  });

  it("is a no-op with persistence off", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect(await deleteSandboxScenario("acme", "acme", "web", "alice")).toBe(false);
  });
});
