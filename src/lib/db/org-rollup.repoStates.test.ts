// first-run-onboarding-wizard#B (challenge-2026-09-23): getRepoStates carries the latest scan's time
// (an ISO string: RepoState crosses to the onboarding client) and whether that scan was a PREVIEW
// (the deterministic mock floor), so the wizard never calls a preview-scored repo "unchanged, free".

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetPrisma, mockIsDbConfigured } = vi.hoisted(() => ({
  mockGetPrisma: vi.fn(),
  mockIsDbConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: mockIsDbConfigured }));

import { getRepoStates } from "@/lib/db/org-rollup";

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

    const args = findMany.mock.calls[0]![0] as { select: { scans: { select: Record<string, unknown> } } };
    expect(args.select.scans.select).toMatchObject({ scannedAt: true, engineProvider: true });
  });
});
