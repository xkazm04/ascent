// scans-read's private parseJson (scans-read.ts:1247-1257) logs unparseable persisted JSON.
//
// Every column it reads was written by JSON.stringify, so a parse failure is DAMAGE. The degraded value
// is unchanged — the field reads as absent (null), exactly as scans-read.test.ts pins — and what this
// file adds is the door: a console.warn saying the column was unreadable, which is the only thing that
// tells a corrupt column apart from one that was never set. A well-formed or NULL column must stay
// quiet. parseJson is module-private, so it is reached through the public seam the sibling test uses:
// getScanReportByCommit over a faked Prisma whose one scan row carries the crafted column.

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

const { mockGetPrisma } = vi.hoisted(() => ({ mockGetPrisma: vi.fn() }));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  getPrisma: mockGetPrisma,
  dbReadSafe: async <T,>(fn: () => Promise<T>) => fn(),
  dbReadStrict: async <T,>(fn: () => Promise<T>) => fn(),
  isP2002Error: () => false,
  withRetry: async <T,>(fn: () => Promise<T>) => fn(),
}));

// resolveOrgId is the only scans-shared seam that needs the DB; the decoders stay REAL.
vi.mock("@/lib/db/scans-shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/scans-shared")>()),
  resolveOrgId: vi.fn(async () => "org_1"),
}));

import { getScanReportByCommit } from "./scans-read";

const DOOR = "persisted JSON column unreadable";

/** One public repo with one scan whose object-typed JSON columns are crafted per test. */
function fakePrisma(cols: { prStats?: string | null; governance?: string | null; techStackJson?: string | null }) {
  const scan = {
    id: "scan_1",
    headSha: "sha_abc",
    overallScore: 70,
    level: "L3",
    archetype: "app",
    adoptionScore: 60,
    rigorScore: 80,
    posture: "ai-native",
    confidence: 0.9,
    headline: "ok",
    engineProvider: "anthropic",
    engineModel: "claude",
    scannedAt: new Date("2026-06-18T00:00:00.000Z"),
    strengths: "[]",
    risks: "[]",
    prStats: cols.prStats ?? null,
    governance: cols.governance ?? null,
    techStackJson: cols.techStackJson ?? null,
    commitActivity: null,
    discrepancies: "[]",
    sensorFailuresJson: null,
    dimensions: [
      {
        dimId: "ci",
        name: "CI",
        weight: 1,
        score: 50,
        signalScore: 50,
        llmScore: 50,
        summary: "s",
        evidence: "[]",
        strengths: "[]",
        gaps: "[]",
      },
    ],
    recommendations: [],
  };
  return {
    repository: {
      findUnique: vi.fn(async () => ({
        id: "repo_1",
        owner: "acme",
        name: "widget",
        url: "https://github.com/acme/widget",
        stars: 5,
        primaryLanguage: "TypeScript",
        isPrivate: false,
        contributors: [],
      })),
    },
    scan: { findFirst: vi.fn(async () => scan) },
  };
}

async function reportWith(cols: Parameters<typeof fakePrisma>[0]) {
  mockGetPrisma.mockReturnValue(fakePrisma(cols));
  const report = await getScanReportByCommit("acme", "widget", { headSha: "sha_abc" });
  expect(report).not.toBeNull();
  return report!;
}

/** console.warn first-argument messages naming THIS door. */
const doorWarnings = (spy: MockInstance) => spy.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(DOOR));

let warn: MockInstance;

beforeEach(() => {
  vi.clearAllMocks();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => warn.mockRestore());

describe("getScanReportByCommit — parseJson's unreadable-column door", () => {
  it("a malformed prStats column reads as absent (null) AND logs that the column is unreadable", async () => {
    const r = await reportWith({ prStats: "{not json" });
    expect(r.prStats).toBeNull();
    const msgs = doorWarnings(warn);
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    expect(msgs[0]).toContain("[scans-read]");
  });

  it("a malformed governance column reads as absent and reaches the same door", async () => {
    const r = await reportWith({ governance: '{"codeowners":tru' });
    expect(r.governance).toBeNull();
    expect(doorWarnings(warn).length).toBeGreaterThanOrEqual(1);
  });

  it("valid JSON of the wrong shape is refused by the shape guard WITHOUT the damage warning", async () => {
    const r = await reportWith({ prStats: "[1,2,3]", governance: "5" });
    expect(r.prStats).toBeNull();
    expect(r.governance).toBeNull();
    expect(doorWarnings(warn)).toEqual([]);
  });

  it("NULL columns (never written) and well-formed columns stay quiet", async () => {
    expect((await reportWith({})).prStats).toBeNull();
    const r = await reportWith({ prStats: '{"open":3,"merged":10}' });
    expect(r.prStats).toEqual({ open: 3, merged: 10 });
    expect(doorWarnings(warn)).toEqual([]);
  });
});
