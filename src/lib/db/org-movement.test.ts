// The count math behind the Alerts chip's unread badge. Prisma is faked (same pattern as
// org-signals.test.ts) so what's pinned is exactly this module's contract: the window is measured
// STRICTLY after the watermark, the read is ONE bounded query (never a per-repo fan-out), and the
// count saturates at the display cap instead of a second count query.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma, mockGetOrgId } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPrisma: vi.fn(),
  mockGetOrgId: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ isDbConfigured: mockIsDbConfigured, getPrisma: mockGetPrisma }));
vi.mock("@/lib/db/org-rollup", () => ({ getOrgId: mockGetOrgId }));

import { getOrgMovementSince, MOVEMENT_CAP } from "./org-movement";

const SINCE = new Date("2026-07-20T00:00:00Z");

/** One persisted scan-pipeline memory row, as the query selects it. */
function row(i: number, event = "regression", namespace: string | null = `acme/repo${i}`) {
  return {
    namespace,
    tags: JSON.stringify([namespace, event]),
    content: `Regression detected on acme/repo${i}`,
    createdAt: new Date(SINCE.getTime() + (i + 1) * 3_600_000),
  };
}

const findMany = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
  mockGetOrgId.mockResolvedValue("org_1");
  mockGetPrisma.mockReturnValue({ orgMemory: { findMany } });
});

describe("getOrgMovementSince", () => {
  it("filters STRICTLY after the watermark, scoped to this org's scan-fed memories, in ONE bounded query", async () => {
    findMany.mockResolvedValue([row(0), row(1)]);
    const m = await getOrgMovementSince("acme", SINCE);

    expect(findMany).toHaveBeenCalledTimes(1); // one query, no per-repo fan-out
    const args = findMany.mock.calls[0]![0] as {
      where: Record<string, unknown>;
      take: number;
      orderBy: unknown;
    };
    expect(args.where).toMatchObject({ orgId: "org_1", source: "scan-pipeline", createdAt: { gt: SINCE } });
    expect(args.where).toMatchObject({ archived: false, supersededBy: null });
    // cap + 1: the extra row is the "there are more" probe, so the capped display needs no 2nd query.
    expect(args.take).toBe(MOVEMENT_CAP + 1);
    expect(args.orderBy).toEqual({ createdAt: "desc" });

    expect(m).not.toBeNull();
    expect(m!.count).toBe(2);
    expect(m!.capped).toBe(false);
    expect(m!.since).toBe(SINCE);
    expect(m!.items[0]).toMatchObject({ repo: "acme/repo0", event: "regression" });
  });

  it("zero-state: nothing since the watermark is count 0, NOT a null (up to date ≠ no data)", async () => {
    findMany.mockResolvedValue([]);
    const m = await getOrgMovementSince("acme", SINCE);
    expect(m).toEqual({ since: SINCE, items: [], count: 0, capped: false });
  });

  it("saturates at the cap: the probe row is dropped from the list and flips `capped`", async () => {
    findMany.mockResolvedValue(Array.from({ length: MOVEMENT_CAP + 1 }, (_, i) => row(i)));
    const m = await getOrgMovementSince("acme", SINCE);
    expect(m!.count).toBe(MOVEMENT_CAP);
    expect(m!.items).toHaveLength(MOVEMENT_CAP);
    expect(m!.capped).toBe(true);
  });

  it("carries the event tag through, and survives a malformed/absent tags blob", async () => {
    findMany.mockResolvedValue([
      row(0, "level-change"),
      { namespace: "acme/x", tags: "not-json", content: "…", createdAt: SINCE },
      { namespace: null, tags: null, content: "…", createdAt: SINCE },
    ]);
    const m = await getOrgMovementSince("acme", SINCE);
    expect(m!.items.map((i) => i.event)).toEqual(["level-change", "", ""]);
    expect(m!.items[2]!.repo).toBeNull();
  });

  it("returns null (degrade to the countless chip) when persistence is off or the org is unknown", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect(await getOrgMovementSince("acme", SINCE)).toBeNull();

    mockIsDbConfigured.mockReturnValue(true);
    mockGetOrgId.mockResolvedValue(null);
    expect(await getOrgMovementSince("acme", SINCE)).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });
});
