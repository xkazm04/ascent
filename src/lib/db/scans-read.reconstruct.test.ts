// The reconstructed report carries every report column the scan persisted (card scan-persist-0).
//
// persistScanReport writes contextHealthJson, manifestJson, guidanceGraphJson, practiceShape and
// platformSignalsJson onto every Scan row. getScanReportByCommit used to drop all five, so a DB-tier
// cache hit, a permalink, a foundation PR and a lane install each saw a report that had never been
// assessed on those axes. These cases pin the read half through the only public seam, with a faked
// Prisma row; the decoders themselves stay real.

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import {
  FIVE_COLUMNS,
  FIVE_FIELDS,
  MANIFEST,
  OBSERVED_TEST_COMMAND,
} from "./scan-row-codec.test-helpers";

const { mockGetPrisma } = vi.hoisted(() => ({ mockGetPrisma: vi.fn() }));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  getPrisma: mockGetPrisma,
  dbReadSafe: async <T,>(fn: () => Promise<T>) => fn(),
  dbReadStrict: async <T,>(fn: () => Promise<T>) => fn(),
}));

vi.mock("@/lib/db/scans-shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./scans-shared")>()),
  resolveOrgId: vi.fn(async () => "org_1"),
}));

import { getScanReportByCommit } from "./scans-read";
import { buildManifest } from "@/lib/standard/manifest";

const FIVE_KEYS = ["manifest", "contextHealth", "guidanceGraph", "practiceShape", "platformSignals"] as const;

function scanRow(cols: Partial<Record<keyof typeof FIVE_COLUMNS, string | null>>) {
  return {
    id: "scan_1",
    repoId: "repo_1",
    headSha: "sha_abc",
    dedupKey: null,
    overallScore: 70,
    level: "L3",
    levelName: "Practicing",
    archetype: "app",
    adoptionScore: 60,
    rigorScore: 80,
    posture: "ai-native",
    confidence: 0.9,
    engineProvider: "anthropic",
    engineModel: "claude",
    headline: "ok",
    strengths: '["has CI"]',
    risks: "[]",
    discrepancies: "[]",
    prStats: null,
    governance: null,
    commitActivity: "[1,2,3]",
    techStackJson: null,
    passportJson: null,
    warningsJson: null,
    aiUsageJson: null,
    rubricVersion: null,
    engineByom: null,
    engineDegraded: null,
    scoreIntegrityJson: null,
    sensorFailuresJson: '["governance"]',
    inputTokens: null,
    outputTokens: null,
    llmLatencyMs: null,
    scannedAt: new Date("2026-06-18T00:00:00.000Z"),
    createdAt: new Date("2026-06-18T00:00:00.000Z"),
    manifestJson: null,
    contextHealthJson: null,
    guidanceGraphJson: null,
    practiceShape: null,
    platformSignalsJson: null,
    ...cols,
    dimensions: [],
    recommendations: [],
  };
}

async function reconstruct(cols: Parameters<typeof scanRow>[0]) {
  const row = scanRow(cols);
  mockGetPrisma.mockReturnValue({
    repository: {
      findUnique: vi.fn(async () => ({
        id: "repo_1",
        owner: "acme",
        name: "widget",
        url: "https://github.com/acme/widget",
        stars: 5,
        primaryLanguage: "TypeScript",
        isPrivate: false,
        passportOverridesJson: null,
        contributors: [],
      })),
    },
    scan: { findFirst: vi.fn(async () => row) },
  });
  const report = await getScanReportByCommit("acme", "widget");
  expect(report).not.toBeNull();
  return report!;
}

let warn: MockInstance;
beforeEach(() => {
  vi.clearAllMocks();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe("getScanReportByCommit - the five report columns decode back onto the report", () => {
  it("an ok manifest readout comes back deep-equal", async () => {
    const r = await reconstruct({ manifestJson: FIVE_COLUMNS.manifestJson });
    expect(r.manifest).toEqual(MANIFEST);
  });

  it("guidanceGraph, contextHealth, practiceShape and platformSignals each equal the stored value", async () => {
    const r = await reconstruct(FIVE_COLUMNS);
    expect(r.guidanceGraph).toEqual(FIVE_FIELDS.guidanceGraph);
    expect(r.contextHealth).toEqual(FIVE_FIELDS.contextHealth);
    expect(r.practiceShape).toEqual(FIVE_FIELDS.practiceShape);
    expect(r.platformSignals).toEqual(FIVE_FIELDS.platformSignals);
  });

  it("NULL columns leave the five keys ABSENT (not null, not [], not {})", async () => {
    const r = await reconstruct({});
    for (const k of FIVE_KEYS) expect(k in r, k).toBe(false);
  });

  it("a corrupt manifestJson reads absent with one warning, and every other field still decodes", async () => {
    const r = await reconstruct({ ...FIVE_COLUMNS, manifestJson: "{not json" });
    expect("manifest" in r).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(r.guidanceGraph).toEqual(FIVE_FIELDS.guidanceGraph);
    expect(r.platformSignals).toEqual(FIVE_FIELDS.platformSignals);
    expect(r.strengths).toEqual(["has CI"]);
    expect(r.commitActivity).toEqual([1, 2, 3]);
    expect(r.sensorFailures).toEqual(["governance"]);
  });
});

describe("buildManifest over a reconstructed report", () => {
  it("regenerates over the repo's observed contract (the foundation PR path)", async () => {
    const r = await reconstruct({ manifestJson: FIVE_COLUMNS.manifestJson });
    const body = buildManifest(r).body;
    expect(body).toContain(OBSERVED_TEST_COMMAND);
    expect(body).toContain("Widgets for acme.");
  });
});
