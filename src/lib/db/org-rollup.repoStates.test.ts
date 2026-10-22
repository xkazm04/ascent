// first-run-onboarding-wizard#B (challenge-2026-09-23): getRepoStates carries the latest scan's time
// (an ISO string: RepoState crosses to the onboarding client) and whether that scan was a PREVIEW
// (the deterministic mock floor), so the wizard never calls a preview-scored repo "unchanged, free".

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetPrisma, mockIsDbConfigured } = vi.hoisted(() => ({
  mockGetPrisma: vi.fn(),
  mockIsDbConfigured: vi.fn(() => true),
}));

// The readers pick each repo's latest scan through the door (org-rollup-latest-scans.ts); this adapter
// serves the nested `scans: [latest]` fixtures below as the Scan table that door reads.
vi.mock("@/lib/db/client", async () => {
  const { servingNestedScans } = await import("./org-rollup-latest-scans.test-helpers");
  return { getPrisma: (...a: unknown[]) => servingNestedScans(mockGetPrisma(...a)), isDbConfigured: mockIsDbConfigured };
});

import { getRepoStates } from "@/lib/db/org-rollup";
import { servingNestedScans } from "./org-rollup-latest-scans.test-helpers";

function prismaWith(rows: unknown[]) {
  const findMany = vi.fn(async () => rows);
  return {
    findMany,
    prisma: {
      organization: { findUnique: vi.fn(async () => ({ id: "org_1", slug: "acme" })), findFirst: vi.fn(async () => ({ id: "org_1", slug: "acme" })) },
      repository: { findMany },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
});

describe("getRepoStates: scannedAt and preview", () => {
  it("adds the latest scan's scannedAt as an ISO string and preview from its engine", async () => {
    const { prisma, findMany } = prismaWith([
      {
        fullName: "acme/live",
        watched: true,
        scanSchedule: "weekly",
        scans: [{ level: "L3", overallScore: 62, scannedAt: new Date("2026-09-20T10:00:00.000Z"), engineProvider: "anthropic" }],
      },
      {
        fullName: "acme/preview",
        watched: true,
        scanSchedule: "off",
        scans: [{ level: "L2", overallScore: 41, scannedAt: new Date("2026-09-21T10:00:00.000Z"), engineProvider: "mock" }],
      },
      { fullName: "acme/never", watched: false, scanSchedule: "off", scans: [] },
    ]);
    mockGetPrisma.mockReturnValue(prisma);

    const states = await getRepoStates("acme");

    expect(states["acme/live"]).toEqual({
      watched: true,
      scanSchedule: "weekly",
      level: "L3",
      overall: 62,
      scannedAt: "2026-09-20T10:00:00.000Z",
      preview: false,
    });
    expect(states["acme/preview"]).toMatchObject({ level: "L2", preview: true, scannedAt: "2026-09-21T10:00:00.000Z" });
    expect(states["acme/never"]).toEqual({ watched: false, scanSchedule: "off", level: null, overall: null, scannedAt: null, preview: false });
    expect(typeof states["acme/live"]!.scannedAt).toBe("string");

    // The latest scan comes through the door's pair fetch, not a nested `scans` select.
    expect((findMany.mock.calls[0] as unknown as [{ select: Record<string, unknown> }])[0].select.scans).toBeUndefined();
    const pair = (servingNestedScans(prisma).scan.findMany as unknown as { mock: { calls: [{ select: Record<string, unknown> }][] } }).mock.calls[0]![0];
    expect(pair.select).toMatchObject({ scannedAt: true, engineProvider: true });
  });
});
